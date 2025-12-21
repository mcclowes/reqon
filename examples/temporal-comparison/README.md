# Reqon vs Temporal: E-Commerce Order Reconciliation

This example demonstrates a complex multi-vendor order reconciliation pipeline that syncs data from Shopify, Stripe, and ShipStation, validates for discrepancies, and stores results in a database.

## The Scenario

An e-commerce company needs to:
1. Sync orders from Shopify (source of truth for orders)
2. Sync payments from Stripe (source of truth for payments)
3. Sync shipments from ShipStation (source of truth for fulfillment)
4. Cross-reference and validate all three data sources
5. Flag discrepancies (unpaid orders, missing shipments, refund mismatches)
6. Store reconciled data with audit trail
7. Handle rate limits, retries, and pagination across all APIs
8. Run daily with incremental sync

## The Numbers

| Metric | Reqon | Temporal |
|--------|-------|----------|
| **Total Lines of Code** | ~280 | ~1,500+ |
| **Files** | 1 | 12 |
| **Dependencies** | 1 (reqon) | 8+ (@temporalio/*, axios, pg, stripe) |
| **Infrastructure** | None | Temporal Server + PostgreSQL + Workers |
| **Setup Time** | 0 minutes | 30+ minutes |
| **Learning Curve** | Hours | Days/Weeks |

## Side-by-Side Comparison

### 1. API Pagination

**Reqon** (2 lines):
```vague
paginate: cursor(page_info, 250, "link.next"),
until: response.orders.length == 0,
```

**Temporal** (40+ lines):
```typescript
let cursor: string | null = null;
do {
  Context.current().heartbeat({ page: pageCount, ordersFound: allOrders.length });
  const { orders, nextCursor } = await client.fetchOrdersPage(cursor, since);
  for (const order of orders) {
    allOrders.push(transformOrder(order));
  }
  cursor = nextCursor;
  pageCount++;
} while (cursor);
```

### 2. Rate Limiting

**Reqon** (4 lines):
```vague
rateLimit: {
  strategy: "pause",
  maxWait: 120,
  fallbackRpm: 40
}
```

**Temporal** (50+ lines):
```typescript
class ShopifyClient {
  private rateLimitState: RateLimitState | null = null;

  private updateRateLimitState(headers: Record<string, string>): void {
    // Parse headers, calculate remaining, track reset time...
  }

  private async waitForRateLimit(): Promise<void> {
    if (!this.rateLimitState) return;
    if (this.rateLimitState.remaining < 5) {
      const waitTime = Math.max(0, this.rateLimitState.resetAt.getTime() - Date.now());
      if (waitTime > 0) {
        await new Promise((resolve) => setTimeout(resolve, waitTime));
      }
    }
  }
}
```

### 3. Schema Transformation

**Reqon** (15 lines):
```vague
map order -> UnifiedOrder {
  order_id: "shopify_" + .id,
  customer_email: .customer.email,
  total_amount: .total_price,
  payment_status: match .financial_status {
    "paid" => "captured",
    "pending" => "pending",
    "refunded" => "refunded",
    _ => "unknown"
  }
}
```

**Temporal** (30+ lines):
```typescript
function transformOrder(order: ShopifyOrder): UnifiedOrder {
  const paymentStatusMap: Record<string, string> = {
    paid: 'captured',
    partially_paid: 'partial',
    pending: 'pending',
    refunded: 'refunded',
    partially_refunded: 'partial_refund',
  };

  return {
    order_id: `shopify_${order.id}`,
    customer_email: order.customer?.email || '',
    total_amount: parseFloat(order.total_price),
    payment_status: paymentStatusMap[order.financial_status] || 'unknown',
    // ... 10 more fields
  };
}
```

### 4. Validation Rules

**Reqon** (5 lines):
```vague
validate order {
  assume payment_exists == true
} or {
  store { type: "missing_payment", ... } -> discrepancies { ... }
}
```

**Temporal** (50+ lines):
```typescript
export async function validateOrdersHavePayments(
  orders: UnifiedOrder[],
  payments: UnifiedPayment[]
): Promise<Discrepancy[]> {
  const discrepancies: Discrepancy[] = [];
  const paymentsByOrderId = new Map<string, UnifiedPayment[]>();

  for (const payment of payments) {
    const existing = paymentsByOrderId.get(payment.order_id) || [];
    existing.push(payment);
    paymentsByOrderId.set(payment.order_id, existing);
  }

  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);

  for (const order of orders) {
    if (order.payment_status === 'pending' && order.created_at < threeDaysAgo) {
      const orderPayments = paymentsByOrderId.get(order.order_id);
      if (!orderPayments || orderPayments.length === 0) {
        discrepancies.push({
          id: `disc_${order.order_id}_no_payment`,
          // ... more fields
        });
      }
    }
  }
  return discrepancies;
}
```

### 5. Pipeline Orchestration with Parallel Execution

**Reqon** (3 lines):
```vague
// Fetch from all three APIs in parallel, then validate
run [SyncShopifyOrders, SyncStripePayments, SyncShipStationShipments]
  then ValidateReconciliation
```
Brackets indicate parallel execution - all three sync actions run concurrently for maximum performance.

**Temporal** (100+ lines):
```typescript
export async function orderReconciliationWorkflow(): Promise<ReconciliationResult> {
  // Initialize state, queries, signals...
  setHandler(getStatusQuery, () => state);
  setHandler(cancelSignal, () => { cancelled = true; });
  setHandler(pauseSignal, () => { paused = true; });
  setHandler(resumeSignal, () => { paused = false; });

  try {
    state.status = 'syncing_shopify';
    await checkPauseAndCancel();
    const shopifyLastSync = await storage.getCheckpoint('shopify_orders_last_sync');
    const orders = await shopify.fetchAllShopifyOrders(shopifyLastSync);
    state.ordersProcessed = await storage.upsertOrders(orders);
    await storage.setCheckpoint('shopify_orders_last_sync', new Date().toISOString());

    // Repeat for Stripe...
    // Repeat for ShipStation...
    // Validation step...
  } catch (error) {
    state.status = 'failed';
    throw error;
  }
}
```

### 6. Running the Pipeline

**Reqon**:
```bash
# Run once
reqon reconciliation.vague --auth ./credentials.json

# Dry run
reqon reconciliation.vague --dry-run

# Resume from checkpoint
reqon reconciliation.vague --resume exec-abc123

# Schedule with cron
0 2 * * * reqon reconciliation.vague
```

**Temporal**:
```bash
# 1. Start PostgreSQL
docker-compose up -d postgresql

# 2. Start Temporal Server
docker-compose up -d temporal temporal-ui

# 3. Wait for server to be ready
sleep 30

# 4. Start worker (in separate terminal)
npx ts-node src/workers/main.ts

# 5. Trigger workflow
npx ts-node src/client/schedule.ts run

# 6. (Optional) Create schedule
npx ts-node src/client/schedule.ts schedule
```

## When to Use Which

### Use Reqon When:
- ✅ Your workflow is data synchronization / ETL
- ✅ You need to fetch, transform, validate, and store data
- ✅ You want minimal infrastructure
- ✅ Business users need to understand the pipeline
- ✅ You need quick iteration and prototyping
- ✅ The "happy path" is the main path
- ✅ Retry/backoff/rate-limiting are your main concerns

### Use Temporal When:
- ⚡ You need human-in-the-loop workflows
- ⚡ You have complex branching/conditional logic
- ⚡ You need workflow versioning/migration
- ⚡ You need sub-second latency on signals
- ⚡ You're building microservice orchestration
- ⚡ You need the full power of a programming language
- ⚡ You already have Temporal infrastructure

## Files

### Reqon Solutions

Reqon supports both single-file and modular folder structures:

**Single File** (`reconciliation.vague`):
- The complete solution in ~280 lines
- Best for quick prototyping or small pipelines

**Modular Folder** (`reconciliation/`):
```
reconciliation/
├── mission.vague        # Sources, stores, schemas, and pipeline orchestration
├── sync-shopify.vague   # SyncShopifyOrders action
├── sync-stripe.vague    # SyncStripePayments action
├── sync-shipstation.vague # SyncShipStationShipments action
└── validate.vague       # ValidateReconciliation action
```
- Same functionality, separated by concern
- Actions are automatically merged at load time
- Best for larger pipelines or team collaboration
- Run with: `reqon reconciliation/` (folder path)

### Temporal Solution (11 files, ~1,500 lines)
```
temporal/
├── types/
│   └── index.ts          # Type definitions (130 lines)
├── config/
│   └── retry.ts          # Retry configuration (50 lines)
├── activities/
│   ├── index.ts          # Activity exports
│   ├── shopify.ts        # Shopify API (220 lines)
│   ├── stripe.ts         # Stripe API (150 lines)
│   ├── shipstation.ts    # ShipStation API (180 lines)
│   ├── validation.ts     # Validation logic (180 lines)
│   └── storage.ts        # Database operations (160 lines)
├── workflows/
│   └── orderReconciliation.ts  # Main workflow (200 lines)
├── workers/
│   └── main.ts           # Worker setup (100 lines)
└── client/
    └── schedule.ts       # Scheduler client (180 lines)
```

## The Bottom Line

For data synchronization pipelines, Reqon offers:

1. **10x less code** - Focus on *what* you want, not *how* to do it
2. **Zero infrastructure** - Run anywhere Node.js runs
3. **Domain-specific** - Built specifically for fetch/transform/validate/store
4. **Readable** - Business logic is visible, not buried in code
5. **Batteries included** - Pagination, rate limiting, retries, checkpointing built-in

Temporal is a powerful general-purpose workflow engine, but for the specific domain of data pipelines, it's like using a chainsaw to cut butter. Reqon is purpose-built for this domain and shows in every aspect of the developer experience.
