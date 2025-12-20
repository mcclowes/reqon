// Shopify API activities
// This single file handles what Reqon does with a few lines of DSL

import axios, { AxiosInstance, AxiosError } from 'axios';
import { Context } from '@temporalio/activity';
import { ShopifyOrder, UnifiedOrder, PaginatedResponse } from '../types';

// Custom error types for non-retryable errors
export class ShopifyAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ShopifyAuthError';
  }
}

export class ShopifyNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ShopifyNotFoundError';
  }
}

export class ShopifyRateLimitError extends Error {
  retryAfter: number;
  constructor(message: string, retryAfter: number) {
    super(message);
    this.name = 'ShopifyRateLimitError';
    this.retryAfter = retryAfter;
  }
}

// Rate limiter state - in Temporal, we need to manage this ourselves
interface RateLimitState {
  remaining: number;
  limit: number;
  resetAt: Date;
  lastRequest: Date;
}

class ShopifyClient {
  private client: AxiosInstance;
  private rateLimitState: RateLimitState | null = null;

  constructor() {
    const shopifyDomain = process.env.SHOPIFY_DOMAIN;
    const accessToken = process.env.SHOPIFY_ACCESS_TOKEN;

    if (!shopifyDomain || !accessToken) {
      throw new ShopifyAuthError('Missing Shopify credentials');
    }

    this.client = axios.create({
      baseURL: `https://${shopifyDomain}/admin/api/2024-01`,
      headers: {
        'X-Shopify-Access-Token': accessToken,
        'Content-Type': 'application/json',
      },
    });

    // Response interceptor for rate limit tracking
    this.client.interceptors.response.use(
      (response) => {
        this.updateRateLimitState(response.headers);
        return response;
      },
      async (error: AxiosError) => {
        if (error.response?.status === 429) {
          const retryAfter = parseInt(
            error.response.headers['retry-after'] || '60',
            10
          );
          throw new ShopifyRateLimitError(
            'Rate limit exceeded',
            retryAfter * 1000
          );
        }
        if (error.response?.status === 401) {
          throw new ShopifyAuthError('Invalid Shopify credentials');
        }
        if (error.response?.status === 404) {
          throw new ShopifyNotFoundError('Resource not found');
        }
        throw error;
      }
    );
  }

  private updateRateLimitState(headers: Record<string, string>): void {
    const remaining = parseInt(headers['x-shopify-shop-api-call-limit'] || '40/40', 10);
    const [used, limit] = (headers['x-shopify-shop-api-call-limit'] || '0/40')
      .split('/')
      .map(Number);

    this.rateLimitState = {
      remaining: limit - used,
      limit,
      resetAt: new Date(Date.now() + 60000), // Shopify resets every minute
      lastRequest: new Date(),
    };
  }

  private async waitForRateLimit(): Promise<void> {
    if (!this.rateLimitState) return;

    // If we're getting low on requests, slow down
    if (this.rateLimitState.remaining < 5) {
      const waitTime = Math.max(
        0,
        this.rateLimitState.resetAt.getTime() - Date.now()
      );
      if (waitTime > 0) {
        console.log(`Rate limit low (${this.rateLimitState.remaining}), waiting ${waitTime}ms`);
        await new Promise((resolve) => setTimeout(resolve, waitTime));
      }
    }
  }

  async fetchOrdersPage(
    cursor: string | null,
    since: string | null
  ): Promise<{
    orders: ShopifyOrder[];
    nextCursor: string | null;
  }> {
    await this.waitForRateLimit();

    const params: Record<string, string> = {
      status: 'any',
      limit: '250',
    };

    if (since) {
      params.updated_at_min = since;
    }

    if (cursor) {
      params.page_info = cursor;
    }

    const response = await this.client.get('/orders.json', { params });

    // Parse Link header for pagination
    const linkHeader = response.headers.link || '';
    const nextMatch = linkHeader.match(/<[^>]*page_info=([^>&]+)[^>]*>;\s*rel="next"/);
    const nextCursor = nextMatch ? nextMatch[1] : null;

    return {
      orders: response.data.orders,
      nextCursor,
    };
  }
}

// Singleton client instance
let shopifyClient: ShopifyClient | null = null;

function getClient(): ShopifyClient {
  if (!shopifyClient) {
    shopifyClient = new ShopifyClient();
  }
  return shopifyClient;
}

// Transform Shopify order to unified format
// In Reqon, this is just `map order -> UnifiedOrder { ... }`
function transformOrder(order: ShopifyOrder): UnifiedOrder {
  const paymentStatusMap: Record<string, string> = {
    paid: 'captured',
    partially_paid: 'partial',
    pending: 'pending',
    refunded: 'refunded',
    partially_refunded: 'partial_refund',
  };

  const fulfillmentStatusMap: Record<string, string> = {
    fulfilled: 'shipped',
    partial: 'partial',
  };

  return {
    order_id: `shopify_${order.id}`,
    external_id: order.id,
    source: 'shopify',
    customer_email: order.customer?.email || '',
    total_amount: parseFloat(order.total_price),
    currency: order.currency,
    status: order.status,
    created_at: new Date(order.created_at),
    line_items_count: order.line_items?.length || 0,
    payment_status: paymentStatusMap[order.financial_status] || 'unknown',
    fulfillment_status:
      order.fulfillment_status
        ? fulfillmentStatusMap[order.fulfillment_status] || order.fulfillment_status
        : 'unfulfilled',
    synced_at: new Date(),
  };
}

// Activity: Fetch all Shopify orders with pagination
// This is what Reqon does automatically with `paginate: cursor(...)`
export async function fetchAllShopifyOrders(
  since: string | null
): Promise<UnifiedOrder[]> {
  const client = getClient();
  const allOrders: UnifiedOrder[] = [];
  let cursor: string | null = null;
  let pageCount = 0;

  do {
    // Heartbeat to keep the activity alive during long pagination
    Context.current().heartbeat({ page: pageCount, ordersFound: allOrders.length });

    const { orders, nextCursor } = await client.fetchOrdersPage(cursor, since);

    // Transform each order
    for (const order of orders) {
      allOrders.push(transformOrder(order));
    }

    cursor = nextCursor;
    pageCount++;

    // Log progress
    console.log(`Shopify: Fetched page ${pageCount}, total orders: ${allOrders.length}`);
  } while (cursor);

  return allOrders;
}

// Activity: Fetch a single order by ID
export async function fetchShopifyOrder(orderId: string): Promise<UnifiedOrder | null> {
  const client = getClient();

  try {
    const response = await (client as any).client.get(`/orders/${orderId}.json`);
    return transformOrder(response.data.order);
  } catch (error) {
    if (error instanceof ShopifyNotFoundError) {
      return null;
    }
    throw error;
  }
}

// Activity: Get last sync timestamp
export async function getShopifyLastSync(): Promise<string | null> {
  // This would query the database - simplified for example
  // In Reqon: sync_state.get("shopify_orders_last_sync")
  return process.env.SHOPIFY_LAST_SYNC || null;
}

// Activity: Update last sync timestamp
export async function updateShopifyLastSync(timestamp: string): Promise<void> {
  // This would update the database - simplified for example
  // In Reqon: store { "shopify_orders_last_sync": now() } -> sync_state { key: ... }
  console.log(`Updated Shopify last sync to: ${timestamp}`);
}
