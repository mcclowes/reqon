// Order Reconciliation Workflow
// This is the Temporal equivalent of:
//   run SyncShopifyOrders
//     then SyncStripePayments
//     then SyncShipStationShipments
//     then ValidateReconciliation
//
// Notice how much ceremony is required compared to Reqon's declarative approach

import {
  proxyActivities,
  defineQuery,
  defineSignal,
  setHandler,
  condition,
  sleep,
  workflowInfo,
  ApplicationFailure,
} from '@temporalio/workflow';

import type * as shopifyActivities from '../activities/shopify';
import type * as stripeActivities from '../activities/stripe';
import type * as shipstationActivities from '../activities/shipstation';
import type * as validationActivities from '../activities/validation';
import type * as storageActivities from '../activities/storage';

import {
  shopifyActivityOptions,
  stripeActivityOptions,
  shipStationActivityOptions,
  databaseActivityOptions,
  validationActivityOptions,
} from '../config/retry';

import { ReconciliationResult, UnifiedOrder, UnifiedPayment, UnifiedShipment } from '../types';

// Proxy activities with their respective retry policies
const shopify = proxyActivities<typeof shopifyActivities>(shopifyActivityOptions);
const stripe = proxyActivities<typeof stripeActivities>(stripeActivityOptions);
const shipstation = proxyActivities<typeof shipstationActivities>(shipStationActivityOptions);
const validation = proxyActivities<typeof validationActivities>(validationActivityOptions);
const storage = proxyActivities<typeof storageActivities>(databaseActivityOptions);

// Workflow state
interface WorkflowState {
  status: 'pending' | 'syncing_shopify' | 'syncing_stripe' | 'syncing_shipstation' | 'validating' | 'completed' | 'failed';
  ordersProcessed: number;
  paymentsProcessed: number;
  shipmentsProcessed: number;
  discrepanciesFound: number;
  error?: string;
  startedAt: Date;
  completedAt?: Date;
}

// Define queries to check workflow status
export const getStatusQuery = defineQuery<WorkflowState>('getStatus');

// Define signals to control workflow
export const cancelSignal = defineSignal('cancel');
export const pauseSignal = defineSignal('pause');
export const resumeSignal = defineSignal('resume');

// Main workflow
export async function orderReconciliationWorkflow(): Promise<ReconciliationResult> {
  const startTime = Date.now();
  let cancelled = false;
  let paused = false;

  // Initialize workflow state
  const state: WorkflowState = {
    status: 'pending',
    ordersProcessed: 0,
    paymentsProcessed: 0,
    shipmentsProcessed: 0,
    discrepanciesFound: 0,
    startedAt: new Date(),
  };

  // Set up query handler
  setHandler(getStatusQuery, () => state);

  // Set up signal handlers
  setHandler(cancelSignal, () => {
    cancelled = true;
  });

  setHandler(pauseSignal, () => {
    paused = true;
  });

  setHandler(resumeSignal, () => {
    paused = false;
  });

  // Helper to check for cancellation/pause
  const checkPauseAndCancel = async () => {
    if (cancelled) {
      throw ApplicationFailure.nonRetryable('Workflow cancelled by user');
    }
    while (paused) {
      await condition(() => !paused || cancelled, '1m');
      if (cancelled) {
        throw ApplicationFailure.nonRetryable('Workflow cancelled by user');
      }
    }
  };

  try {
    // ========================================
    // STEP 1: Sync Shopify Orders
    // ========================================
    state.status = 'syncing_shopify';
    await checkPauseAndCancel();

    // Get last sync checkpoint
    const shopifyLastSync = await storage.getCheckpoint('shopify_orders_last_sync');

    // Fetch all orders (with automatic pagination handled in activity)
    const orders = await shopify.fetchAllShopifyOrders(shopifyLastSync);

    // Store orders
    state.ordersProcessed = await storage.upsertOrders(orders);

    // Update checkpoint
    await storage.setCheckpoint('shopify_orders_last_sync', new Date().toISOString());

    console.log(`Synced ${state.ordersProcessed} Shopify orders`);

    // ========================================
    // STEP 2: Sync Stripe Payments
    // ========================================
    state.status = 'syncing_stripe';
    await checkPauseAndCancel();

    // Get last sync checkpoint (as Unix timestamp for Stripe)
    const stripeLastSyncStr = await storage.getCheckpoint('stripe_payments_last_sync');
    const stripeLastSync = stripeLastSyncStr
      ? Math.floor(new Date(stripeLastSyncStr).getTime() / 1000)
      : null;

    // Fetch all payments
    const payments = await stripe.fetchAllStripePayments(stripeLastSync);

    // Store payments
    state.paymentsProcessed = await storage.upsertPayments(payments);

    // Update checkpoint
    await storage.setCheckpoint('stripe_payments_last_sync', new Date().toISOString());

    console.log(`Synced ${state.paymentsProcessed} Stripe payments`);

    // ========================================
    // STEP 3: Sync ShipStation Shipments
    // ========================================
    state.status = 'syncing_shipstation';
    await checkPauseAndCancel();

    // Get last sync checkpoint
    const shipstationLastSync = await storage.getCheckpoint('shipstation_last_sync');

    // Fetch all shipments
    const shipments = await shipstation.fetchAllShipStationShipments(shipstationLastSync);

    // Store shipments
    state.shipmentsProcessed = await storage.upsertShipments(shipments);

    // Update checkpoint
    await storage.setCheckpoint('shipstation_last_sync', new Date().toISOString());

    console.log(`Synced ${state.shipmentsProcessed} ShipStation shipments`);

    // ========================================
    // STEP 4: Validate and Reconcile
    // ========================================
    state.status = 'validating';
    await checkPauseAndCancel();

    // Get all data for validation
    const allOrders = await storage.getAllOrders();
    const allPayments = await storage.getAllPayments();
    const allShipments = await storage.getAllShipments();

    // Run all validations
    const validationResult = await validation.runAllValidations(
      allOrders,
      allPayments,
      allShipments
    );

    // Store discrepancies
    state.discrepanciesFound = await storage.upsertDiscrepancies(
      validationResult.discrepancies
    );

    console.log(`Found ${state.discrepanciesFound} discrepancies`);

    // ========================================
    // Complete
    // ========================================
    state.status = 'completed';
    state.completedAt = new Date();

    const duration = Date.now() - startTime;

    return {
      ordersProcessed: state.ordersProcessed,
      paymentsProcessed: state.paymentsProcessed,
      shipmentsProcessed: state.shipmentsProcessed,
      discrepanciesFound: state.discrepanciesFound,
      duration,
    };
  } catch (error) {
    state.status = 'failed';
    state.error = error instanceof Error ? error.message : String(error);
    throw error;
  }
}

// Child workflow for parallel sync (alternative approach)
export async function parallelSyncWorkflow(): Promise<{
  orders: UnifiedOrder[];
  payments: UnifiedPayment[];
  shipments: UnifiedShipment[];
}> {
  // Get all checkpoints in parallel
  const [shopifyLastSync, stripeLastSyncStr, shipstationLastSync] =
    await Promise.all([
      storage.getCheckpoint('shopify_orders_last_sync'),
      storage.getCheckpoint('stripe_payments_last_sync'),
      storage.getCheckpoint('shipstation_last_sync'),
    ]);

  const stripeLastSync = stripeLastSyncStr
    ? Math.floor(new Date(stripeLastSyncStr).getTime() / 1000)
    : null;

  // Fetch from all sources in parallel
  // Note: This is more efficient but harder to debug than sequential
  const [orders, payments, shipments] = await Promise.all([
    shopify.fetchAllShopifyOrders(shopifyLastSync),
    stripe.fetchAllStripePayments(stripeLastSync),
    shipstation.fetchAllShipStationShipments(shipstationLastSync),
  ]);

  // Store all in parallel
  await Promise.all([
    storage.upsertOrders(orders),
    storage.upsertPayments(payments),
    storage.upsertShipments(shipments),
  ]);

  // Update all checkpoints
  const now = new Date().toISOString();
  await Promise.all([
    storage.setCheckpoint('shopify_orders_last_sync', now),
    storage.setCheckpoint('stripe_payments_last_sync', now),
    storage.setCheckpoint('shipstation_last_sync', now),
  ]);

  return { orders, payments, shipments };
}
