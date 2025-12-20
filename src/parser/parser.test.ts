import { describe, it, expect } from 'vitest';
import { ReqonLexer } from '../lexer/index.js';
import { ReqonParser } from './parser.js';

describe('ReqonParser', () => {
  function parse(source: string) {
    const lexer = new ReqonLexer(source);
    const tokens = lexer.tokenize();
    const parser = new ReqonParser(tokens);
    return parser.parse();
  }

  it('parses a simple mission', () => {
    const source = `
      mission TestMission {
        source API {
          auth: bearer,
          base: "https://api.example.com"
        }

        store items: memory("items")

        action FetchItems {
          fetch GET "/items"

          store response -> items {
            key: .id
          }
        }

        run FetchItems
      }
    `;

    const program = parse(source);

    expect(program.type).toBe('ReqonProgram');
    expect(program.statements).toHaveLength(1);

    const mission = program.statements[0];
    expect(mission.type).toBe('MissionDefinition');

    if (mission.type === 'MissionDefinition') {
      expect(mission.name).toBe('TestMission');
      expect(mission.sources).toHaveLength(1);
      expect(mission.stores).toHaveLength(1);
      expect(mission.actions).toHaveLength(1);
      expect(mission.pipeline.stages).toHaveLength(1);
    }
  });

  it('parses fetch with pagination', () => {
    const source = `
      mission PaginatedFetch {
        source API {
          auth: oauth2,
          base: "https://api.example.com"
        }

        store items: memory("items")

        action FetchAll {
          fetch GET "/items" {
            paginate: offset(page, 50),
            until: response.items.length == 0
          }

          store response.items -> items {
            key: .id
          }
        }

        run FetchAll
      }
    `;

    const program = parse(source);
    const mission = program.statements[0];

    if (mission.type === 'MissionDefinition') {
      const action = mission.actions[0];
      const fetchStep = action.steps[0];

      if (fetchStep.type === 'FetchStep') {
        expect(fetchStep.paginate).toBeDefined();
        expect(fetchStep.paginate?.type).toBe('offset');
        expect(fetchStep.paginate?.pageSize).toBe(50);
        expect(fetchStep.until).toBeDefined();
      }
    }
  });

  it('parses for loops with conditions', () => {
    const source = `
      mission IterateItems {
        source API {
          auth: bearer,
          base: "https://api.example.com"
        }

        store items: memory("items")

        action ProcessItems {
          for item in items where .status == "pending" {
            fetch GET "/items/{item.id}"

            store response -> items {
              key: .id,
              upsert: true
            }
          }
        }

        run ProcessItems
      }
    `;

    const program = parse(source);
    const mission = program.statements[0];

    if (mission.type === 'MissionDefinition') {
      const action = mission.actions[0];
      const forStep = action.steps[0];

      if (forStep.type === 'ForStep') {
        expect(forStep.variable).toBe('item');
        expect(forStep.condition).toBeDefined();
        expect(forStep.steps).toHaveLength(2);
      }
    }
  });

  it('parses map steps with match expressions', () => {
    const source = `
      mission MapItems {
        source API {
          auth: bearer,
          base: "https://api.example.com"
        }

        store raw: memory("raw")
        store normalized: memory("normalized")

        action Normalize {
          for item in raw {
            map item -> StandardItem {
              id: .external_id,
              status: match .state {
                "active" => "enabled",
                "inactive" => "disabled",
                _ => "unknown"
              }
            }

            store response -> normalized {
              key: .id
            }
          }
        }

        run Normalize
      }
    `;

    const program = parse(source);
    const mission = program.statements[0];

    if (mission.type === 'MissionDefinition') {
      const action = mission.actions[0];
      const forStep = action.steps[0];

      if (forStep.type === 'ForStep') {
        const mapStep = forStep.steps[0];
        if (mapStep.type === 'MapStep') {
          expect(mapStep.targetSchema).toBe('StandardItem');
          expect(mapStep.mappings).toHaveLength(2);
        }
      }
    }
  });

  it('parses validation steps', () => {
    const source = `
      mission ValidateData {
        source API {
          auth: bearer,
          base: "https://api.example.com"
        }

        store data: memory("data")

        action Fetch {
          fetch GET "/data"

          validate response {
            assume length(.items) > 0,
            assume .count > 0
          }

          store response.items -> data {
            key: .id
          }
        }

        run Fetch
      }
    `;

    const program = parse(source);
    const mission = program.statements[0];

    if (mission.type === 'MissionDefinition') {
      const action = mission.actions[0];
      const validateStep = action.steps[1];

      if (validateStep.type === 'ValidateStep') {
        expect(validateStep.constraints).toHaveLength(2);
      }
    }
  });

  it('parses pipeline with multiple stages', () => {
    const source = `
      mission MultiStage {
        source API {
          auth: bearer,
          base: "https://api.example.com"
        }

        store data: memory("data")

        action Step1 {
          fetch GET "/step1"
          store response -> data { key: .id }
        }

        action Step2 {
          fetch GET "/step2"
          store response -> data { key: .id }
        }

        action Step3 {
          fetch GET "/step3"
          store response -> data { key: .id }
        }

        run Step1 then Step2 then Step3
      }
    `;

    const program = parse(source);
    const mission = program.statements[0];

    if (mission.type === 'MissionDefinition') {
      expect(mission.pipeline.stages).toHaveLength(3);
      expect(mission.pipeline.stages[0].action).toBe('Step1');
      expect(mission.pipeline.stages[1].action).toBe('Step2');
      expect(mission.pipeline.stages[2].action).toBe('Step3');
    }
  });

  it('parses parallel stages with bracket syntax', () => {
    const source = `
      mission ParallelSync {
        source API {
          auth: bearer,
          base: "https://api.example.com"
        }

        store orders: memory("orders")
        store payments: memory("payments")
        store reconciled: memory("reconciled")

        action FetchOrders {
          fetch GET "/orders"
          store response -> orders { key: .id }
        }

        action FetchPayments {
          fetch GET "/payments"
          store response -> payments { key: .id }
        }

        action Reconcile {
          fetch GET "/reconcile"
          store response -> reconciled { key: .id }
        }

        run [FetchOrders, FetchPayments] then Reconcile
      }
    `;

    const program = parse(source);
    const mission = program.statements[0];

    if (mission.type === 'MissionDefinition') {
      expect(mission.pipeline.stages).toHaveLength(2);

      // First stage is parallel
      const parallelStage = mission.pipeline.stages[0];
      expect(parallelStage.actions).toBeDefined();
      expect(parallelStage.actions).toEqual(['FetchOrders', 'FetchPayments']);
      expect(parallelStage.action).toBeUndefined();

      // Second stage is sequential
      const sequentialStage = mission.pipeline.stages[1];
      expect(sequentialStage.action).toBe('Reconcile');
      expect(sequentialStage.actions).toBeUndefined();
    }
  });

  it('parses multiple parallel stages', () => {
    const source = `
      mission ComplexPipeline {
        source API {
          auth: bearer,
          base: "https://api.example.com"
        }

        store data: memory("data")

        action A { fetch GET "/a" }
        action B { fetch GET "/b" }
        action C { fetch GET "/c" }
        action D { fetch GET "/d" }
        action E { fetch GET "/e" }

        run A then [B, C, D] then E
      }
    `;

    const program = parse(source);
    const mission = program.statements[0];

    if (mission.type === 'MissionDefinition') {
      expect(mission.pipeline.stages).toHaveLength(3);

      expect(mission.pipeline.stages[0].action).toBe('A');
      expect(mission.pipeline.stages[1].actions).toEqual(['B', 'C', 'D']);
      expect(mission.pipeline.stages[2].action).toBe('E');
    }
  });

  it('parses parallel stage with three actions', () => {
    const source = `
      mission TripleParallel {
        source API {
          auth: bearer,
          base: "https://api.example.com"
        }

        store data: memory("data")

        action X { fetch GET "/x" }
        action Y { fetch GET "/y" }
        action Z { fetch GET "/z" }

        run [X, Y, Z]
      }
    `;

    const program = parse(source);
    const mission = program.statements[0];

    if (mission.type === 'MissionDefinition') {
      expect(mission.pipeline.stages).toHaveLength(1);
      expect(mission.pipeline.stages[0].actions).toEqual(['X', 'Y', 'Z']);
    }
  });
});
