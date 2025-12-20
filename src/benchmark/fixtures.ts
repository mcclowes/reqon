/**
 * DSL fixtures of varying complexity for benchmarking
 */

// Simple: minimal valid DSL
export const SIMPLE_DSL = `
mission "simple"
  source api from "https://api.example.com"
  store results in memory

  action fetchData
    fetch "/data" from api
    store response in results
`;

// Medium: typical real-world usage with mapping and validation
export const MEDIUM_DSL = `
mission "medium-complexity"
  source api from "https://api.example.com" with
    auth: bearer "token123"
    rateLimit: 100

  store users in memory
  store orders in memory

  action fetchUsers
    fetch "/users" from api
    for user in response.data where user.active == true
      map user -> {
        id: user.id,
        name: user.firstName + " " + user.lastName,
        email: user.email
      }
      validate
        assume id is string
        assume name is string
        assume email is string
      store mapped in users with key: mapped.id
    end

  action fetchOrders
    fetch "/orders" from api with
      pagination: offset
      pageSize: 50
    for order in response
      map order -> {
        orderId: order.id,
        total: order.amount * 100,
        status: order.status
      }
      store mapped in orders with key: mapped.orderId
    end

  run fetchUsers then fetchOrders
`;

// Complex: multiple sources, conditional logic, nested transformations
export const COMPLEX_DSL = `
mission "complex-pipeline"
  source primaryApi from "https://api.primary.com" with
    auth: oauth2 {
      tokenUrl: "https://auth.primary.com/token",
      clientId: "client123",
      clientSecret: "secret456",
      scope: "read write"
    }
    timeout: 30000
    retries: 3
    backoff: exponential
    circuitBreaker: {
      failureThreshold: 5,
      resetTimeout: 60000
    }

  source secondaryApi from "https://api.secondary.com" with
    auth: apiKey {
      header: "X-API-Key",
      value: "key789"
    }
    rateLimit: 50

  store products in memory
  store inventory in memory
  store combined in memory
  store errors in memory

  action fetchProducts
    fetch "/products" from primaryApi with
      pagination: cursor
      pageSize: 100
      since: lastSync
    for product in response.items where product.status != "deleted"
      map product -> {
        sku: product.sku,
        name: product.name,
        price: product.price.amount,
        currency: product.price.currency,
        category: product.category.name,
        tags: product.tags
      }
      validate
        assume sku is string
        assume name is string
        assume price is number
        assume price > 0
      store mapped in products with key: mapped.sku
    end

  action fetchInventory
    fetch "/inventory" from secondaryApi with
      pagination: page
      pageSize: 200
    for item in response.data
      map item -> {
        sku: item.productSku,
        quantity: item.onHand,
        warehouse: item.location.warehouse,
        lastUpdated: item.updatedAt
      }
      validate
        assume sku is string
        assume quantity is number
        assume quantity >= 0
      store mapped in inventory with key: mapped.sku + "-" + mapped.warehouse
    end

  action combineData
    for product in products
      for inv in inventory where inv.sku == product.sku
        map { product: product, inventory: inv } -> {
          sku: product.sku,
          name: product.name,
          price: product.price,
          quantity: inv.quantity,
          warehouse: inv.warehouse,
          available: inv.quantity > 0,
          value: product.price * inv.quantity
        }
        store mapped in combined with key: mapped.sku + "-" + mapped.warehouse
      end
    end

  run [fetchProducts, fetchInventory] then combineData
`;

// Expression-heavy: for evaluator benchmarking
export const EXPRESSION_HEAVY_DSL = `
mission "expressions"
  source api from "https://api.example.com"
  store results in memory

  action calculate
    fetch "/data" from api
    for item in response.items
      map item -> {
        // Arithmetic
        sum: item.a + item.b + item.c,
        product: item.x * item.y * item.z,
        complex: (item.a + item.b) * (item.c - item.d) / (item.e + 1),

        // String operations
        fullName: item.firstName + " " + item.middleName + " " + item.lastName,
        code: item.prefix + "-" + item.id + "-" + item.suffix,

        // Boolean logic
        isValid: item.active == true and item.verified == true,
        needsReview: item.score < 50 or item.flagged == true,
        complexCheck: (item.type == "A" or item.type == "B") and item.status != "deleted",

        // Comparisons
        tier: match item.score
          when score >= 90 then "platinum"
          when score >= 70 then "gold"
          when score >= 50 then "silver"
          else "bronze"
        end,

        // Nested access
        nested1: item.level1.level2.level3.value,
        nested2: item.data.items[0].nested.field,

        // Mixed
        final: (item.base * item.multiplier) + item.bonus - item.penalty
      }
      store mapped in results with key: mapped.code
    end
`;

// Large: stress test with many actions and stores
export function generateLargeDSL(actionCount: number = 20): string {
  const stores = Array.from(
    { length: actionCount },
    (_, i) => `  store store${i} in memory`
  ).join('\n');

  const actions = Array.from({ length: actionCount }, (_, i) => `
  action action${i}
    fetch "/endpoint${i}" from api with
      pagination: offset
      pageSize: 100
    for item in response.data where item.active == true
      map item -> {
        id: item.id,
        value${i}: item.value * ${i + 1},
        computed: item.a + item.b + ${i}
      }
      validate
        assume id is string
        assume value${i} is number
      store mapped in store${i} with key: mapped.id
    end
`).join('\n');

  const runSequence = Array.from(
    { length: actionCount },
    (_, i) => `action${i}`
  ).join(', ');

  return `
mission "large-stress-test"
  source api from "https://api.example.com" with
    auth: bearer "token"
    rateLimit: 1000

${stores}

${actions}

  run [${runSequence}]
`;
}

// Deeply nested expressions for evaluator stress testing
export const DEEPLY_NESTED_EXPRESSIONS = `
mission "nested-expressions"
  source api from "https://api.example.com"
  store results in memory

  action process
    fetch "/data" from api
    for item in response
      map item -> {
        result: ((((item.a + item.b) * (item.c + item.d)) + ((item.e - item.f) * (item.g - item.h))) * (((item.i + item.j) / (item.k + 1)) - ((item.l * item.m) + (item.n / (item.o + 1)))))
      }
      store mapped in results
    end
`;

// Match-heavy for pattern matching benchmarks
export const MATCH_HEAVY_DSL = `
mission "pattern-matching"
  source api from "https://api.example.com"
  store results in memory

  action categorize
    fetch "/items" from api
    for item in response
      map item -> {
        id: item.id,
        category: match item.type
          when "A" then "category-a"
          when "B" then "category-b"
          when "C" then "category-c"
          when "D" then "category-d"
          when "E" then "category-e"
          else "other"
        end,
        priority: match item.urgency
          when urgency > 90 then "critical"
          when urgency > 70 then "high"
          when urgency > 50 then "medium"
          when urgency > 30 then "low"
          else "none"
        end,
        status: match item.state
          when "pending" then "awaiting"
          when "processing" then "in-progress"
          when "completed" then "done"
          when "failed" then "error"
          when "cancelled" then "stopped"
          else "unknown"
        end
      }
      store mapped in results with key: mapped.id
    end
`;

export const ALL_FIXTURES = {
  simple: SIMPLE_DSL,
  medium: MEDIUM_DSL,
  complex: COMPLEX_DSL,
  expressionHeavy: EXPRESSION_HEAVY_DSL,
  deeplyNested: DEEPLY_NESTED_EXPRESSIONS,
  matchHeavy: MATCH_HEAVY_DSL,
};
