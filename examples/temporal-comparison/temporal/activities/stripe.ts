// Stripe API activities
// Another 200+ lines for what Reqon does declaratively

import Stripe from 'stripe';
import { Context } from '@temporalio/activity';
import { StripePaymentIntent, UnifiedPayment } from '../types';

// Custom errors
export class StripeAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StripeAuthError';
  }
}

export class StripeCardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StripeCardError';
  }
}

// Initialize Stripe client
function getStripeClient(): Stripe {
  const apiKey = process.env.STRIPE_SECRET_KEY;
  if (!apiKey) {
    throw new StripeAuthError('Missing Stripe API key');
  }
  return new Stripe(apiKey, {
    apiVersion: '2023-10-16',
    maxNetworkRetries: 0, // We handle retries via Temporal
  });
}

// Transform Stripe payment to unified format
// In Reqon: map payment -> UnifiedPayment { ... }
function transformPayment(payment: Stripe.PaymentIntent): UnifiedPayment {
  const statusMap: Record<string, string> = {
    succeeded: 'captured',
    requires_capture: 'authorized',
    canceled: 'voided',
    requires_payment_method: 'pending',
    requires_confirmation: 'pending',
    requires_action: 'pending',
    processing: 'processing',
  };

  const shopifyOrderId = payment.metadata?.shopify_order_id;
  const charge = payment.charges?.data?.[0];

  return {
    payment_id: `stripe_${payment.id}`,
    order_id: shopifyOrderId ? `shopify_${shopifyOrderId}` : '',
    amount: payment.amount / 100, // Convert from cents
    currency: payment.currency,
    status: statusMap[payment.status] || payment.status,
    method: payment.payment_method_types?.[0] || 'unknown',
    captured_at: charge ? new Date(charge.created * 1000) : new Date(),
    refunded_amount: charge ? charge.amount_refunded / 100 : 0,
  };
}

// Activity: Fetch all Stripe payments with pagination
export async function fetchAllStripePayments(
  since: number | null
): Promise<UnifiedPayment[]> {
  const stripe = getStripeClient();
  const allPayments: UnifiedPayment[] = [];
  let hasMore = true;
  let startingAfter: string | undefined;
  let pageCount = 0;

  const params: Stripe.PaymentIntentListParams = {
    limit: 100,
    expand: ['data.charges'],
  };

  if (since) {
    params.created = { gte: since };
  }

  while (hasMore) {
    // Heartbeat for long-running pagination
    Context.current().heartbeat({
      page: pageCount,
      paymentsFound: allPayments.length
    });

    if (startingAfter) {
      params.starting_after = startingAfter;
    }

    try {
      const response = await stripe.paymentIntents.list(params);

      // Filter and transform payments that have a Shopify order ID
      for (const payment of response.data) {
        if (payment.metadata?.shopify_order_id) {
          allPayments.push(transformPayment(payment));
        }
      }

      hasMore = response.has_more;
      if (response.data.length > 0) {
        startingAfter = response.data[response.data.length - 1].id;
      }

      pageCount++;
      console.log(`Stripe: Fetched page ${pageCount}, total payments: ${allPayments.length}`);
    } catch (error) {
      if (error instanceof Stripe.errors.StripeAuthenticationError) {
        throw new StripeAuthError('Invalid Stripe API key');
      }
      if (error instanceof Stripe.errors.StripeCardError) {
        throw new StripeCardError(error.message);
      }
      throw error;
    }
  }

  return allPayments;
}

// Activity: Fetch a single payment by ID
export async function fetchStripePayment(paymentId: string): Promise<UnifiedPayment | null> {
  const stripe = getStripeClient();

  try {
    const payment = await stripe.paymentIntents.retrieve(paymentId, {
      expand: ['charges'],
    });
    return transformPayment(payment);
  } catch (error) {
    if (error instanceof Stripe.errors.StripeInvalidRequestError) {
      return null;
    }
    throw error;
  }
}

// Activity: Get last sync timestamp
export async function getStripeLastSync(): Promise<number | null> {
  // Would query database
  const lastSync = process.env.STRIPE_LAST_SYNC;
  return lastSync ? parseInt(lastSync, 10) : null;
}

// Activity: Update last sync timestamp
export async function updateStripeLastSync(timestamp: number): Promise<void> {
  console.log(`Updated Stripe last sync to: ${new Date(timestamp * 1000).toISOString()}`);
}

// Activity: Fetch refunds for reconciliation
export async function fetchStripeRefunds(
  paymentIntentId: string
): Promise<Array<{ id: string; amount: number; status: string }>> {
  const stripe = getStripeClient();

  const refunds = await stripe.refunds.list({
    payment_intent: paymentIntentId,
    limit: 100,
  });

  return refunds.data.map((refund) => ({
    id: refund.id,
    amount: refund.amount / 100,
    status: refund.status || 'unknown',
  }));
}
