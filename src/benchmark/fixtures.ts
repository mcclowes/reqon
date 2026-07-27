/**
 * DSL fixtures of varying complexity for benchmarking.
 *
 * These are written in the same syntax the parser actually accepts - the same
 * dialect every example and parser test uses (`mission Name { ... }`, brace
 * blocks, `get`/`store ->`, `map x -> Schema { ... }`, guarded `match { }`).
 * `fixtures.test.ts` parses every one of them so they can't silently rot again.
 */

// Simple: minimal valid DSL
export const SIMPLE_DSL = `
mission Simple {
  source API {
    auth: none,
    base: "https://api.example.com"
  }

  store results: memory("results")

  action FetchData {
    get "/data" {
      source: API
    }

    store response -> results {
      key: .id
    }
  }

  run FetchData
}
`;

// Medium: typical real-world usage with mapping and validation
export const MEDIUM_DSL = `
mission MediumComplexity {
  source API {
    auth: bearer,
    base: "https://api.example.com"
  }

  store users: memory("users")
  store orders: memory("orders")

  schema User {
    id: string,
    name: string,
    email: string
  }

  schema Order {
    orderId: string,
    total: decimal,
    status: string
  }

  action FetchUsers {
    get "/users" {
      source: API
    }

    for user in response.data where .active == true {
      map user -> User {
        id: user.id,
        name: user.firstName + " " + user.lastName,
        email: user.email
      }

      validate response {
        assume .id is string,
        assume .name is string,
        assume .email is string
      }

      store response -> users {
        key: .id
      }
    }
  }

  action FetchOrders {
    get "/orders" {
      source: API,
      paginate: offset(offset, 50)
    }

    for order in response.data {
      map order -> Order {
        orderId: order.id,
        total: order.amount * 100,
        status: order.status
      }

      store response -> orders {
        key: .orderId
      }
    }
  }

  run FetchUsers
    then FetchOrders
}
`;

// Complex: multiple sources, conditional logic, nested transformations
export const COMPLEX_DSL = `
mission ComplexPipeline {
  source PrimaryApi {
    auth: oauth2,
    base: "https://api.primary.com",
    circuitBreaker: {
      failureThreshold: 5,
      resetTimeout: 60000
    }
  }

  source SecondaryApi {
    auth: api_key,
    base: "https://api.secondary.com",
    rateLimit: {
      strategy: "throttle",
      fallbackRpm: 50
    }
  }

  store products: memory("products")
  store inventory: memory("inventory")
  store combined: memory("combined")
  store errors: memory("errors")

  schema Product {
    sku: string,
    name: string,
    price: decimal,
    currency: string,
    category: string,
    tags: array
  }

  schema InventoryItem {
    sku: string,
    quantity: int,
    warehouse: string,
    lastUpdated: date
  }

  schema Combined {
    sku: string,
    name: string,
    price: decimal,
    quantity: int,
    warehouse: string,
    available: boolean,
    value: decimal
  }

  action FetchProducts {
    get "/products" {
      source: PrimaryApi,
      paginate: cursor(cursor, 100, "meta.next_cursor"),
      since: lastSync,
      retry: {
        maxAttempts: 3,
        backoff: exponential,
        initialDelay: 500
      }
    }

    for product in response.items where .status != "deleted" {
      map product -> Product {
        sku: product.sku,
        name: product.name,
        price: product.price.amount,
        currency: product.price.currency,
        category: product.category.name,
        tags: product.tags
      }

      validate response {
        assume .sku is string,
        assume .name is string,
        assume .price is number,
        assume .price > 0
      }

      store response -> products {
        key: .sku
      }
    }
  }

  action FetchInventory {
    get "/inventory" {
      source: SecondaryApi,
      paginate: page(page, 200)
    }

    for item in response.data {
      map item -> InventoryItem {
        sku: item.productSku,
        quantity: item.onHand,
        warehouse: item.location.warehouse,
        lastUpdated: item.updatedAt
      }

      validate response {
        assume .sku is string,
        assume .quantity is number,
        assume .quantity >= 0
      }

      store response -> inventory {
        key: .sku + "-" + .warehouse
      }
    }
  }

  action CombineData {
    for product in products {
      for inv in inventory where .sku == product.sku {
        map inv -> Combined {
          sku: product.sku,
          name: product.name,
          price: product.price,
          quantity: inv.quantity,
          warehouse: inv.warehouse,
          available: inv.quantity > 0,
          value: product.price * inv.quantity
        }

        store response -> combined {
          key: product.sku + "-" + inv.warehouse
        }
      }
    }
  }

  run [FetchProducts, FetchInventory]
    then CombineData
}
`;

// Expression-heavy: for evaluator benchmarking
export const EXPRESSION_HEAVY_DSL = `
mission Expressions {
  source API {
    auth: none,
    base: "https://api.example.com"
  }

  store results: memory("results")

  schema Computed {
    sum: number,
    product: number,
    complex: number,
    fullName: string,
    code: string,
    isValid: boolean,
    needsReview: boolean,
    complexCheck: boolean,
    tier: string,
    nested1: number,
    nested2: number,
    final: number
  }

  action Calculate {
    get "/data" {
      source: API
    }

    for item in response.items {
      map item -> Computed {
        sum: item.a + item.b + item.c,
        product: item.x * item.y * item.z,
        complex: (item.a + item.b) * (item.c - item.d) / (item.e + 1),

        fullName: item.firstName + " " + item.middleName + " " + item.lastName,
        code: item.prefix + "-" + item.id + "-" + item.suffix,

        isValid: item.active == true and item.verified == true,
        needsReview: item.score < 50 or item.flagged == true,
        complexCheck: (item.type == "A" or item.type == "B") and item.status != "deleted",

        tier: match item.score {
          s where s >= 90 => "platinum",
          s where s >= 70 => "gold",
          s where s >= 50 => "silver",
          _ => "bronze"
        },

        nested1: item.level1.level2.level3.value,
        nested2: item.data.items[0].nested.field,

        final: (item.base * item.multiplier) + item.bonus - item.penalty
      }

      store response -> results {
        key: item.id
      }
    }
  }

  run Calculate
}
`;

// Large: stress test with many actions and stores
export function generateLargeDSL(actionCount: number = 20): string {
  const stores = Array.from(
    { length: actionCount },
    (_, i) => `  store store${i}: memory("store${i}")`
  ).join('\n');

  const schemas = Array.from(
    { length: actionCount },
    (_, i) => `  schema Schema${i} {
    id: string,
    value${i}: number,
    computed: number
  }`
  ).join('\n\n');

  const actions = Array.from(
    { length: actionCount },
    (_, i) => `  action Action${i} {
    get "/endpoint${i}" {
      source: api,
      paginate: offset(offset, 100)
    }

    for item in response.data where .active == true {
      map item -> Schema${i} {
        id: item.id,
        value${i}: item.value * ${i + 1},
        computed: item.a + item.b + ${i}
      }

      validate response {
        assume .id is string,
        assume .value${i} is number
      }

      store response -> store${i} {
        key: .id
      }
    }
  }`
  ).join('\n\n');

  const runSequence = Array.from({ length: actionCount }, (_, i) => `Action${i}`).join(', ');

  return `
mission LargeStressTest {
  source api {
    auth: bearer,
    base: "https://api.example.com"
  }

${stores}

${schemas}

${actions}

  run [${runSequence}]
}
`;
}

// Deeply nested expressions for evaluator stress testing
export const DEEPLY_NESTED_EXPRESSIONS = `
mission NestedExpressions {
  source API {
    auth: none,
    base: "https://api.example.com"
  }

  store results: memory("results")

  schema Result {
    result: number
  }

  action Process {
    get "/data" {
      source: API
    }

    for item in response.items {
      map item -> Result {
        result: ((((item.a + item.b) * (item.c + item.d)) + ((item.e - item.f) * (item.g - item.h))) * (((item.i + item.j) / (item.k + 1)) - ((item.l * item.m) + (item.n / (item.o + 1)))))
      }

      store response -> results {
        key: item.id
      }
    }
  }

  run Process
}
`;

// Match-heavy for pattern matching benchmarks
export const MATCH_HEAVY_DSL = `
mission PatternMatching {
  source API {
    auth: none,
    base: "https://api.example.com"
  }

  store results: memory("results")

  schema Categorized {
    id: string,
    category: string,
    priority: string,
    status: string
  }

  action Categorize {
    get "/items" {
      source: API
    }

    for item in response.items {
      map item -> Categorized {
        id: item.id,
        category: match item.type {
          "A" => "category-a",
          "B" => "category-b",
          "C" => "category-c",
          "D" => "category-d",
          "E" => "category-e",
          _ => "other"
        },
        priority: match item.urgency {
          u where u > 90 => "critical",
          u where u > 70 => "high",
          u where u > 50 => "medium",
          u where u > 30 => "low",
          _ => "none"
        },
        status: match item.state {
          "pending" => "awaiting",
          "processing" => "in-progress",
          "completed" => "done",
          "failed" => "error",
          "cancelled" => "stopped",
          _ => "unknown"
        }
      }

      store response -> results {
        key: item.id
      }
    }
  }

  run Categorize
}
`;

export const ALL_FIXTURES = {
  simple: SIMPLE_DSL,
  medium: MEDIUM_DSL,
  complex: COMPLEX_DSL,
  expressionHeavy: EXPRESSION_HEAVY_DSL,
  deeplyNested: DEEPLY_NESTED_EXPRESSIONS,
  matchHeavy: MATCH_HEAVY_DSL,
};
