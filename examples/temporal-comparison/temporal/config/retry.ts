// Retry configuration for each API
// In Temporal, every activity needs its own retry policy configured manually

import { ActivityOptions } from '@temporalio/workflow';

// Shopify has strict rate limits - 40 requests per minute for most plans
export const shopifyActivityOptions: ActivityOptions = {
  startToCloseTimeout: '5m',
  heartbeatTimeout: '30s',
  retry: {
    initialInterval: '2s',
    backoffCoefficient: 2,
    maximumAttempts: 5,
    maximumInterval: '60s',
    nonRetryableErrorTypes: ['ShopifyAuthError', 'ShopifyNotFoundError'],
  },
};

// Stripe is more generous but still needs careful handling
export const stripeActivityOptions: ActivityOptions = {
  startToCloseTimeout: '3m',
  heartbeatTimeout: '20s',
  retry: {
    initialInterval: '1s',
    backoffCoefficient: 2,
    maximumAttempts: 3,
    maximumInterval: '30s',
    nonRetryableErrorTypes: ['StripeAuthError', 'StripeCardError'],
  },
};

// ShipStation has very strict rate limits
export const shipStationActivityOptions: ActivityOptions = {
  startToCloseTimeout: '10m',
  heartbeatTimeout: '60s',
  retry: {
    initialInterval: '3s',
    backoffCoefficient: 2,
    maximumAttempts: 4,
    maximumInterval: '120s',
    nonRetryableErrorTypes: ['ShipStationAuthError'],
  },
};

// Database operations should be fast with minimal retries
export const databaseActivityOptions: ActivityOptions = {
  startToCloseTimeout: '30s',
  retry: {
    initialInterval: '500ms',
    backoffCoefficient: 1.5,
    maximumAttempts: 3,
    maximumInterval: '5s',
    nonRetryableErrorTypes: ['DatabaseConstraintError'],
  },
};

// Validation is local computation, shouldn't fail
export const validationActivityOptions: ActivityOptions = {
  startToCloseTimeout: '1m',
  retry: {
    maximumAttempts: 1, // No retries for pure computation
  },
};
