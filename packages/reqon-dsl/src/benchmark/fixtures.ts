/**
 * DSL fixtures of varying complexity for benchmarking.
 *
 * These must stay valid Reqon: `fixtures.test.ts` parses every one of them so
 * they can't drift from the grammar the way they did before.
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
    get "/data"
    store response -> results { key: .id }
  }

  run FetchData
}
`;

// Medium: typical real-world usage with mapping and validation
export const MEDIUM_DSL = `
mission MediumComplexity {
  source API {
    auth: bearer,
    base: "https://api.example.com",
    rateLimit: {
      strategy: pause,
      maxWait: 60,
      fallbackRpm: 100
    }
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
    get "/users"

    for user in response.data where .active == true {
      map user -> User {
        id: .id,
        name: .firstName + " " + .lastName,
        email: .email
      }

      validate response {
        assume .email != null
        assume length(.name) > 0
      }

      store response -> users { key: .id }
    }
  }

  action FetchOrders {
    get "/orders" {
      paginate: offset(offset, 50),
      until: length(response) == 0
    }

    for order in response {
      map order -> Order {
        orderId: .id,
        total: .amount * 100,
        status: .status
      }

      store response -> orders { key: .orderId }
    }
  }

  run FetchUsers then FetchOrders
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
    auth: bearer,
    base: "https://api.secondary.com",
    rateLimit: {
      strategy: throttle,
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
    category: string
  }

  schema InventoryItem {
    sku: string,
    quantity: int,
    warehouse: string
  }

  schema CombinedItem {
    sku: string,
    name: string,
    quantity: int,
    available: boolean,
    value: decimal
  }

  action FetchProducts {
    get "/products" {
      source: PrimaryApi,
      paginate: cursor(cursor, 100, "meta.next_cursor"),
      until: length(response.items) == 0,
      since: lastSync,
      retry: {
        maxAttempts: 3,
        backoff: exponential,
        initialDelay: 1000
      }
    }

    for product in response.items where .status != "deleted" {
      map product -> Product {
        sku: .sku,
        name: .name,
        price: .price.amount,
        currency: .price.currency,
        category: .category.name
      }

      validate response {
        assume length(.sku) > 0
        assume .price > 0
      }

      store response -> products { key: .sku }
    }
  }

  action FetchInventory {
    get "/inventory" {
      source: SecondaryApi,
      paginate: page(page, 200),
      until: length(response.data) == 0
    }

    for item in response.data {
      map item -> InventoryItem {
        sku: .productSku,
        quantity: .onHand,
        warehouse: .location.warehouse
      }

      validate response {
        assume .quantity >= 0
      }

      store response -> inventory { key: .sku + "-" + .warehouse }
    }
  }

  action CombineData {
    for product in products {
      for inv in inventory where .sku == product.sku {
        map inv -> CombinedItem {
          sku: product.sku,
          name: product.name,
          quantity: .quantity,
          available: .quantity > 0,
          value: product.price * .quantity
        }

        store response -> combined { key: .sku + "-" + .warehouse }
      }
    }
  }

  run [FetchProducts, FetchInventory] then CombineData
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
    code: string,
    sum: decimal,
    product: decimal,
    complex: decimal,
    fullName: string,
    isValid: boolean,
    needsReview: boolean,
    complexCheck: boolean,
    tier: string,
    nested1: string,
    nested2: string,
    final: decimal
  }

  action Calculate {
    get "/data"

    for item in response.items {
      map item -> Computed {
        // Arithmetic
        sum: .a + .b + .c,
        product: .x * .y * .z,
        complex: (.a + .b) * (.c - .d) / (.e + 1),

        // String operations
        fullName: .firstName + " " + .middleName + " " + .lastName,
        code: .prefix + "-" + .id + "-" + .suffix,

        // Boolean logic
        isValid: .active == true and .verified == true,
        needsReview: .score < 50 or .flagged == true,
        complexCheck: (.type == "A" or .type == "B") and .status != "deleted",

        // Match expression
        tier: match .grade {
          "A" => "platinum",
          "B" => "gold",
          "C" => "silver",
          _ => "bronze"
        },

        // Nested access
        nested1: .level1.level2.level3.value,
        nested2: .data.items[0].nested.field,

        // Mixed
        final: (.base * .multiplier) + .bonus - .penalty
      }

      store response -> results { key: .code }
    }
  }

  run Calculate
}
`;

// Deeply nested expressions for evaluator stress testing
export const DEEPLY_NESTED_EXPRESSIONS = `
mission NestedExpressions {
  source API {
    auth: none,
    base: "https://api.example.com"
  }

  store results: memory("results")

  schema Result {
    id: string,
    result: decimal
  }

  action Process {
    get "/data"

    for item in response {
      map item -> Result {
        id: .id,
        result: ((((.a + .b) * (.c + .d)) + ((.e - .f) * (.g - .h))) * (((.i + .j) / (.k + 1)) - ((.l * .m) + (.n / (.o + 1)))))
      }

      store response -> results { key: .id }
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
    get "/items"

    for item in response {
      map item -> Categorized {
        id: .id,
        category: match .type {
          "A" => "category-a",
          "B" => "category-b",
          "C" => "category-c",
          "D" => "category-d",
          "E" => "category-e",
          _ => "other"
        },
        priority: match .urgency {
          "critical" => "p0",
          "high" => "p1",
          "medium" => "p2",
          "low" => "p3",
          _ => "none"
        },
        status: match .state {
          "pending" => "awaiting",
          "processing" => "in-progress",
          "completed" => "done",
          "failed" => "error",
          "cancelled" => "stopped",
          _ => "unknown"
        }
      }

      store response -> results { key: .id }
    }
  }

  run Categorize
}
`;

// Store-only processing: no network, for benchmarking execution over pre-populated stores
export const STORE_ONLY_DSL = `
mission StoreProcessing {
  store input: memory("input")
  store output: memory("output")

  schema Processed {
    id: string,
    fullName: string,
    score: decimal,
    category: string
  }

  action Process {
    for item in input where .active == true {
      map item -> Processed {
        id: .id,
        fullName: .firstName + " " + .lastName,
        score: .value * 2,
        category: match .tier {
          "A" => "premium",
          "B" => "standard",
          _ => "basic"
        }
      }

      validate response {
        assume length(.id) > 0
        assume .score >= 0
      }

      store response -> output { key: .id }
    }
  }

  run Process
}
`;

// Complex store processing: nested loops and multiple stores, still no network
export const COMPLEX_STORE_DSL = `
mission ComplexStoreProcessing {
  store users: memory("users")
  store orders: memory("orders")
  store reports: memory("reports")

  schema UserReport {
    userId: string,
    displayName: string,
    tier: string,
    eligible: boolean
  }

  schema OrderReport {
    orderId: string,
    userId: string,
    total: decimal,
    discount: decimal,
    status: string
  }

  action ProcessUsers {
    for user in users where .active == true {
      map user -> UserReport {
        userId: .id,
        displayName: .firstName + " " + .lastName,
        tier: match .tier {
          "A" => "platinum",
          "B" => "gold",
          "C" => "silver",
          _ => "bronze"
        },
        eligible: .verified == true and .age >= 18
      }

      validate response {
        assume length(.userId) > 0
      }

      store response -> reports { key: .userId }
    }
  }

  action ProcessOrders {
    for order in orders {
      for report in reports where .userId == order.userId {
        map order -> OrderReport {
          orderId: .id,
          userId: .userId,
          total: .amount * 100,
          discount: match .status {
            "completed" => .amount * 0.2,
            "pending" => .amount * 0.15,
            "cancelled" => .amount * 0.1,
            _ => .amount * 0.05
          },
          status: .status
        }

        store response -> reports { key: .orderId, partial: true }
      }
    }
  }

  run ProcessUsers then ProcessOrders
}
`;

// Large: stress test with many actions and stores
export function generateLargeDSL(actionCount: number = 20): string {
  const stores = Array.from(
    { length: actionCount },
    (_, i) => `  store store${i}: memory("store${i}")`
  ).join('\n');

  const actions = Array.from(
    { length: actionCount },
    (_, i) => `
  action Action${i} {
    get "/endpoint${i}" {
      paginate: offset(offset, 100),
      until: length(response.data) == 0
    }

    for item in response.data where .active == true {
      map item -> Item {
        id: .id,
        value: .value * ${i + 1},
        computed: .a + .b + ${i}
      }

      validate response {
        assume length(.id) > 0
        assume .value >= 0
      }

      store response -> store${i} { key: .id }
    }
  }
`
  ).join('\n');

  const runSequence = Array.from({ length: actionCount }, (_, i) => `Action${i}`).join(', ');

  return `
mission LargeStressTest {
  source API {
    auth: bearer,
    base: "https://api.example.com",
    rateLimit: {
      strategy: pause,
      fallbackRpm: 1000
    }
  }

  schema Item {
    id: string,
    value: decimal,
    computed: decimal
  }

${stores}
${actions}
  run [${runSequence}]
}
`;
}

export const ALL_FIXTURES = {
  simple: SIMPLE_DSL,
  medium: MEDIUM_DSL,
  complex: COMPLEX_DSL,
  expressionHeavy: EXPRESSION_HEAVY_DSL,
  deeplyNested: DEEPLY_NESTED_EXPRESSIONS,
  matchHeavy: MATCH_HEAVY_DSL,
  storeOnly: STORE_ONLY_DSL,
  complexStore: COMPLEX_STORE_DSL,
};
