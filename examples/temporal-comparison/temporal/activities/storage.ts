// Storage activities
// In Reqon: `store response -> orders { key: .order_id, upsert: true }`
// In Temporal: We need a full database abstraction layer

import { Pool } from 'pg'; // Would use real Postgres
import {
  UnifiedOrder,
  UnifiedPayment,
  UnifiedShipment,
  Discrepancy,
  SyncCheckpoint,
} from '../types';

// In production, this would be a real database connection pool
// For this example, we'll use in-memory maps (similar to Reqon's memory store)
const ordersStore = new Map<string, UnifiedOrder>();
const paymentsStore = new Map<string, UnifiedPayment>();
const shipmentsStore = new Map<string, UnifiedShipment>();
const discrepanciesStore = new Map<string, Discrepancy>();
const checkpointsStore = new Map<string, SyncCheckpoint>();

// Activity: Upsert orders
export async function upsertOrders(orders: UnifiedOrder[]): Promise<number> {
  let count = 0;

  for (const order of orders) {
    ordersStore.set(order.order_id, order);
    count++;
  }

  console.log(`Upserted ${count} orders`);
  return count;
}

// Activity: Upsert payments
export async function upsertPayments(payments: UnifiedPayment[]): Promise<number> {
  let count = 0;

  for (const payment of payments) {
    paymentsStore.set(payment.payment_id, payment);
    count++;
  }

  console.log(`Upserted ${count} payments`);
  return count;
}

// Activity: Upsert shipments
export async function upsertShipments(shipments: UnifiedShipment[]): Promise<number> {
  let count = 0;

  for (const shipment of shipments) {
    shipmentsStore.set(shipment.shipment_id, shipment);
    count++;
  }

  console.log(`Upserted ${count} shipments`);
  return count;
}

// Activity: Upsert discrepancies
export async function upsertDiscrepancies(
  discrepancies: Discrepancy[]
): Promise<number> {
  let count = 0;

  for (const discrepancy of discrepancies) {
    discrepanciesStore.set(discrepancy.id, discrepancy);
    count++;
  }

  console.log(`Upserted ${count} discrepancies`);
  return count;
}

// Activity: Get all orders
export async function getAllOrders(): Promise<UnifiedOrder[]> {
  return Array.from(ordersStore.values());
}

// Activity: Get all payments
export async function getAllPayments(): Promise<UnifiedPayment[]> {
  return Array.from(paymentsStore.values());
}

// Activity: Get all shipments
export async function getAllShipments(): Promise<UnifiedShipment[]> {
  return Array.from(shipmentsStore.values());
}

// Activity: Get checkpoint
export async function getCheckpoint(key: string): Promise<string | null> {
  const checkpoint = checkpointsStore.get(key);
  return checkpoint?.value || null;
}

// Activity: Set checkpoint
export async function setCheckpoint(key: string, value: string): Promise<void> {
  checkpointsStore.set(key, {
    key,
    value,
    updated_at: new Date(),
  });
  console.log(`Set checkpoint ${key} = ${value}`);
}

// Activity: Get orders by filter
export async function getOrdersByStatus(
  status: string
): Promise<UnifiedOrder[]> {
  return Array.from(ordersStore.values()).filter(
    (order) => order.payment_status === status
  );
}

// Activity: Get payments for order
export async function getPaymentsForOrder(orderId: string): Promise<UnifiedPayment[]> {
  return Array.from(paymentsStore.values()).filter(
    (payment) => payment.order_id === orderId
  );
}

// Activity: Get shipments for order
export async function getShipmentsForOrder(
  orderId: string
): Promise<UnifiedShipment[]> {
  return Array.from(shipmentsStore.values()).filter(
    (shipment) => shipment.order_id === orderId
  );
}

// Activity: Clear all data (for testing)
export async function clearAllData(): Promise<void> {
  ordersStore.clear();
  paymentsStore.clear();
  shipmentsStore.clear();
  discrepanciesStore.clear();
  checkpointsStore.clear();
  console.log('Cleared all data');
}

// Activity: Get statistics
export async function getStats(): Promise<{
  orders: number;
  payments: number;
  shipments: number;
  discrepancies: number;
}> {
  return {
    orders: ordersStore.size,
    payments: paymentsStore.size,
    shipments: shipmentsStore.size,
    discrepancies: discrepanciesStore.size,
  };
}

// In a real implementation, these would be SQL queries like:
/*
async function upsertOrdersSQL(orders: UnifiedOrder[]): Promise<number> {
  const pool = getPool();

  const query = `
    INSERT INTO reconciled_orders (
      order_id, external_id, source, customer_email, total_amount,
      currency, status, created_at, line_items_count, payment_status,
      fulfillment_status, synced_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    ON CONFLICT (order_id) DO UPDATE SET
      customer_email = EXCLUDED.customer_email,
      total_amount = EXCLUDED.total_amount,
      status = EXCLUDED.status,
      payment_status = EXCLUDED.payment_status,
      fulfillment_status = EXCLUDED.fulfillment_status,
      synced_at = EXCLUDED.synced_at
  `;

  let count = 0;
  for (const order of orders) {
    await pool.query(query, [
      order.order_id,
      order.external_id,
      order.source,
      order.customer_email,
      order.total_amount,
      order.currency,
      order.status,
      order.created_at,
      order.line_items_count,
      order.payment_status,
      order.fulfillment_status,
      order.synced_at,
    ]);
    count++;
  }

  return count;
}
*/
