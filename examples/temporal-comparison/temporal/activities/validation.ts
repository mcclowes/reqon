// Validation activities
// In Reqon, this is just `validate response { assume ... }`
// In Temporal, we need explicit functions for every validation rule

import {
  UnifiedOrder,
  UnifiedPayment,
  UnifiedShipment,
  Discrepancy,
  Severity,
} from '../types';

interface ValidationResult {
  isValid: boolean;
  discrepancies: Discrepancy[];
}

// Activity: Check for orders without payments
export async function validateOrdersHavePayments(
  orders: UnifiedOrder[],
  payments: UnifiedPayment[]
): Promise<Discrepancy[]> {
  const discrepancies: Discrepancy[] = [];
  const paymentsByOrderId = new Map<string, UnifiedPayment[]>();

  // Build payment lookup
  for (const payment of payments) {
    const existing = paymentsByOrderId.get(payment.order_id) || [];
    existing.push(payment);
    paymentsByOrderId.set(payment.order_id, existing);
  }

  // Check each pending order older than 3 days
  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);

  for (const order of orders) {
    if (order.payment_status === 'pending' && order.created_at < threeDaysAgo) {
      const orderPayments = paymentsByOrderId.get(order.order_id);

      if (!orderPayments || orderPayments.length === 0) {
        discrepancies.push({
          id: `disc_${order.order_id}_no_payment`,
          order_id: order.order_id,
          type: 'missing_payment',
          severity: 'high',
          description: 'Order older than 3 days has no matching Stripe payment',
          shopify_value: String(order.total_amount),
          stripe_value: null,
          shipstation_value: null,
          detected_at: new Date(),
        });
      }
    }
  }

  return discrepancies;
}

// Activity: Check for payment/order amount mismatches
export async function validatePaymentAmounts(
  orders: UnifiedOrder[],
  payments: UnifiedPayment[]
): Promise<Discrepancy[]> {
  const discrepancies: Discrepancy[] = [];
  const paymentsByOrderId = new Map<string, UnifiedPayment[]>();

  // Build payment lookup
  for (const payment of payments) {
    const existing = paymentsByOrderId.get(payment.order_id) || [];
    existing.push(payment);
    paymentsByOrderId.set(payment.order_id, existing);
  }

  for (const order of orders) {
    const orderPayments = paymentsByOrderId.get(order.order_id) || [];
    const totalPaid = orderPayments.reduce((sum, p) => sum + p.amount, 0);

    // Allow for small floating point differences
    const difference = Math.abs(order.total_amount - totalPaid);

    if (difference > 0.01) {
      // Determine severity based on difference amount
      let severity: Severity;
      if (difference > 100) {
        severity = 'critical';
      } else if (difference > 10) {
        severity = 'high';
      } else {
        severity = 'medium';
      }

      discrepancies.push({
        id: `disc_${order.order_id}_amount_mismatch`,
        order_id: order.order_id,
        type: 'amount_mismatch',
        severity,
        description: 'Order total does not match payment total',
        shopify_value: String(order.total_amount),
        stripe_value: String(totalPaid),
        shipstation_value: null,
        detected_at: new Date(),
      });
    }
  }

  return discrepancies;
}

// Activity: Check for shipped orders without shipment records
export async function validateShipmentsExist(
  orders: UnifiedOrder[],
  shipments: UnifiedShipment[]
): Promise<Discrepancy[]> {
  const discrepancies: Discrepancy[] = [];
  const shipmentsByOrderId = new Set(shipments.map((s) => s.order_id));

  for (const order of orders) {
    if (order.fulfillment_status === 'shipped') {
      if (!shipmentsByOrderId.has(order.order_id)) {
        discrepancies.push({
          id: `disc_${order.order_id}_no_shipment`,
          order_id: order.order_id,
          type: 'missing_shipment_record',
          severity: 'medium',
          description: 'Shopify shows fulfilled but no ShipStation shipment found',
          shopify_value: order.fulfillment_status,
          stripe_value: null,
          shipstation_value: null,
          detected_at: new Date(),
        });
      }
    }
  }

  return discrepancies;
}

// Activity: Check for refund status mismatches
export async function validateRefundStatuses(
  orders: UnifiedOrder[],
  payments: UnifiedPayment[]
): Promise<Discrepancy[]> {
  const discrepancies: Discrepancy[] = [];
  const orderById = new Map(orders.map((o) => [o.order_id, o]));

  for (const payment of payments) {
    if (payment.refunded_amount > 0) {
      const order = orderById.get(payment.order_id);

      if (order) {
        const expectedStatuses = ['refunded', 'partial_refund'];
        if (!expectedStatuses.includes(order.payment_status)) {
          discrepancies.push({
            id: `disc_${payment.order_id}_refund_mismatch`,
            order_id: payment.order_id,
            type: 'refund_status_mismatch',
            severity: 'high',
            description: 'Stripe shows refund but Shopify payment status not updated',
            shopify_value: order.payment_status,
            stripe_value: String(payment.refunded_amount),
            shipstation_value: null,
            detected_at: new Date(),
          });
        }
      }
    }
  }

  return discrepancies;
}

// Activity: Run all validations
export async function runAllValidations(
  orders: UnifiedOrder[],
  payments: UnifiedPayment[],
  shipments: UnifiedShipment[]
): Promise<ValidationResult> {
  const allDiscrepancies: Discrepancy[] = [];

  // Run all validation checks
  const [paymentMissing, amountMismatch, shipmentMissing, refundMismatch] =
    await Promise.all([
      validateOrdersHavePayments(orders, payments),
      validatePaymentAmounts(orders, payments),
      validateShipmentsExist(orders, shipments),
      validateRefundStatuses(orders, payments),
    ]);

  allDiscrepancies.push(
    ...paymentMissing,
    ...amountMismatch,
    ...shipmentMissing,
    ...refundMismatch
  );

  // Deduplicate by ID
  const uniqueDiscrepancies = Array.from(
    new Map(allDiscrepancies.map((d) => [d.id, d])).values()
  );

  return {
    isValid: uniqueDiscrepancies.length === 0,
    discrepancies: uniqueDiscrepancies,
  };
}
