// ShipStation API activities
// Yet another 200+ lines of boilerplate

import axios, { AxiosInstance, AxiosError } from 'axios';
import { Context } from '@temporalio/activity';
import { ShipStationShipment, UnifiedShipment } from '../types';

// Custom errors
export class ShipStationAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ShipStationAuthError';
  }
}

export class ShipStationRateLimitError extends Error {
  retryAfter: number;
  constructor(message: string, retryAfter: number) {
    super(message);
    this.name = 'ShipStationRateLimitError';
    this.retryAfter = retryAfter;
  }
}

// ShipStation rate limit tracking
interface RateLimitState {
  remaining: number;
  resetAt: Date;
}

class ShipStationClient {
  private client: AxiosInstance;
  private rateLimitState: RateLimitState | null = null;

  constructor() {
    const apiKey = process.env.SHIPSTATION_API_KEY;
    const apiSecret = process.env.SHIPSTATION_API_SECRET;

    if (!apiKey || !apiSecret) {
      throw new ShipStationAuthError('Missing ShipStation credentials');
    }

    // ShipStation uses Basic Auth with API key:secret
    const authToken = Buffer.from(`${apiKey}:${apiSecret}`).toString('base64');

    this.client = axios.create({
      baseURL: 'https://ssapi.shipstation.com',
      headers: {
        Authorization: `Basic ${authToken}`,
        'Content-Type': 'application/json',
      },
    });

    this.client.interceptors.response.use(
      (response) => {
        this.updateRateLimitState(response.headers);
        return response;
      },
      async (error: AxiosError) => {
        if (error.response?.status === 429) {
          // ShipStation uses X-Rate-Limit-Reset header
          const resetTime = error.response.headers['x-rate-limit-reset'];
          const retryAfter = resetTime
            ? new Date(resetTime).getTime() - Date.now()
            : 30000;
          throw new ShipStationRateLimitError('Rate limit exceeded', retryAfter);
        }
        if (error.response?.status === 401) {
          throw new ShipStationAuthError('Invalid ShipStation credentials');
        }
        throw error;
      }
    );
  }

  private updateRateLimitState(headers: Record<string, string>): void {
    const remaining = parseInt(headers['x-rate-limit-remaining'] || '40', 10);
    const resetTime = headers['x-rate-limit-reset'];

    this.rateLimitState = {
      remaining,
      resetAt: resetTime ? new Date(resetTime) : new Date(Date.now() + 60000),
    };
  }

  private async waitForRateLimit(): Promise<void> {
    if (!this.rateLimitState) return;

    // ShipStation has very strict limits - 40 requests per minute
    if (this.rateLimitState.remaining < 3) {
      const waitTime = Math.max(
        0,
        this.rateLimitState.resetAt.getTime() - Date.now()
      );
      if (waitTime > 0) {
        console.log(
          `ShipStation rate limit low (${this.rateLimitState.remaining}), waiting ${waitTime}ms`
        );
        await new Promise((resolve) => setTimeout(resolve, waitTime));
      }
    }
  }

  async fetchShipmentsPage(
    page: number,
    since: string | null
  ): Promise<{
    shipments: ShipStationShipment[];
    totalPages: number;
  }> {
    await this.waitForRateLimit();

    const params: Record<string, string | number> = {
      pageSize: 500,
      page,
      sortBy: 'CreateDate',
    };

    if (since) {
      params.createDateStart = since;
    }

    const response = await this.client.get('/shipments', { params });

    return {
      shipments: response.data.shipments || [],
      totalPages: response.data.pages || 1,
    };
  }
}

let shipStationClient: ShipStationClient | null = null;

function getClient(): ShipStationClient {
  if (!shipStationClient) {
    shipStationClient = new ShipStationClient();
  }
  return shipStationClient;
}

// Transform ShipStation shipment to unified format
function transformShipment(shipment: ShipStationShipment): UnifiedShipment {
  let status: string;
  if (shipment.voided) {
    status = 'voided';
  } else if (!shipment.trackingNumber) {
    status = 'label_created';
  } else {
    status = 'shipped';
  }

  return {
    shipment_id: `ss_${shipment.shipmentId}`,
    order_id: `shopify_${shipment.orderNumber}`,
    carrier: shipment.carrierCode,
    tracking_number: shipment.trackingNumber,
    status,
    shipped_at: new Date(shipment.shipDate),
    delivered_at: shipment.deliveryDate ? new Date(shipment.deliveryDate) : null,
  };
}

// Activity: Fetch all ShipStation shipments with pagination
export async function fetchAllShipStationShipments(
  since: string | null
): Promise<UnifiedShipment[]> {
  const client = getClient();
  const allShipments: UnifiedShipment[] = [];
  let currentPage = 1;
  let totalPages = 1;

  do {
    // Heartbeat for long-running pagination
    Context.current().heartbeat({
      page: currentPage,
      totalPages,
      shipmentsFound: allShipments.length,
    });

    const { shipments, totalPages: pages } = await client.fetchShipmentsPage(
      currentPage,
      since
    );

    totalPages = pages;

    for (const shipment of shipments) {
      allShipments.push(transformShipment(shipment));
    }

    console.log(
      `ShipStation: Fetched page ${currentPage}/${totalPages}, total shipments: ${allShipments.length}`
    );

    currentPage++;
  } while (currentPage <= totalPages);

  return allShipments;
}

// Activity: Fetch shipment by tracking number
export async function fetchShipmentByTracking(
  trackingNumber: string
): Promise<UnifiedShipment | null> {
  const client = getClient();

  const { shipments } = await (client as any).client.get('/shipments', {
    params: { trackingNumber },
  });

  if (shipments?.length > 0) {
    return transformShipment(shipments[0]);
  }
  return null;
}

// Activity: Get last sync timestamp
export async function getShipStationLastSync(): Promise<string | null> {
  return process.env.SHIPSTATION_LAST_SYNC || null;
}

// Activity: Update last sync timestamp
export async function updateShipStationLastSync(timestamp: string): Promise<void> {
  console.log(`Updated ShipStation last sync to: ${timestamp}`);
}
