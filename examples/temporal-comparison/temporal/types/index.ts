// Type definitions for the order reconciliation workflow
// Temporal requires explicit type definitions for all data structures

export interface ShopifyOrder {
  id: string;
  customer: {
    email: string;
    first_name: string;
    last_name: string;
  };
  total_price: string;
  currency: string;
  status: string;
  financial_status: string;
  fulfillment_status: string | null;
  created_at: string;
  updated_at: string;
  line_items: Array<{
    id: string;
    title: string;
    quantity: number;
    price: string;
  }>;
}

export interface StripePaymentIntent {
  id: string;
  amount: number;
  currency: string;
  status: string;
  payment_method_types: string[];
  metadata: {
    shopify_order_id?: string;
  };
  charges: {
    data: Array<{
      id: string;
      amount: number;
      amount_refunded: number;
      created: number;
    }>;
  };
}

export interface ShipStationShipment {
  shipmentId: number;
  orderNumber: string;
  carrierCode: string;
  trackingNumber: string | null;
  voided: boolean;
  shipDate: string;
  deliveryDate: string | null;
}

export interface UnifiedOrder {
  order_id: string;
  external_id: string;
  source: string;
  customer_email: string;
  total_amount: number;
  currency: string;
  status: string;
  created_at: Date;
  line_items_count: number;
  payment_status: string;
  fulfillment_status: string;
  synced_at: Date;
}

export interface UnifiedPayment {
  payment_id: string;
  order_id: string;
  amount: number;
  currency: string;
  status: string;
  method: string;
  captured_at: Date;
  refunded_amount: number;
}

export interface UnifiedShipment {
  shipment_id: string;
  order_id: string;
  carrier: string;
  tracking_number: string | null;
  status: string;
  shipped_at: Date;
  delivered_at: Date | null;
}

export interface Discrepancy {
  id: string;
  order_id: string;
  type: DiscrepancyType;
  severity: Severity;
  description: string;
  shopify_value: string | null;
  stripe_value: string | null;
  shipstation_value: string | null;
  detected_at: Date;
}

export type DiscrepancyType =
  | 'missing_payment'
  | 'amount_mismatch'
  | 'missing_shipment_record'
  | 'refund_status_mismatch';

export type Severity = 'low' | 'medium' | 'high' | 'critical';

export interface SyncCheckpoint {
  key: string;
  value: string;
  updated_at: Date;
}

export interface PaginatedResponse<T> {
  data: T[];
  hasMore: boolean;
  nextCursor?: string;
}

export interface ReconciliationResult {
  ordersProcessed: number;
  paymentsProcessed: number;
  shipmentsProcessed: number;
  discrepanciesFound: number;
  duration: number;
}
