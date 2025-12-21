import { describe, it, expect } from 'vitest';
import { parse, execute } from './index.js';
import { MemoryStore } from './stores/index.js';

describe('Reqon Integration', () => {
  it('parses and executes a simple mission with dry run', async () => {
    const source = `
      mission TestMission {
        source API {
          auth: bearer,
          base: "https://api.example.com"
        }

        store items: memory("items")

        action FetchItems {
          get "/items"

          store response -> items {
            key: .id
          }
        }

        run FetchItems
      }
    `;

    const program = parse(source);
    expect(program.type).toBe('ReqonProgram');

    const result = await execute(source, { dryRun: true, verbose: false });

    expect(result.success).toBe(true);
    expect(result.actionsRun).toContain('FetchItems');
  });

  it('executes a mission with mock data flow', async () => {
    const source = `
      mission MockDataFlow {
        source API {
          auth: bearer,
          base: "https://api.example.com"
        }

        store raw: memory("raw")
        store processed: memory("processed")

        action Process {
          for item in raw {
            map item -> Processed {
              id: .id,
              name: .title,
              value: .amount
            }

            store response -> processed {
              key: .id
            }
          }
        }

        run Process
      }
    `;

    // Pre-populate the raw store
    const rawStore = new MemoryStore('raw');
    await rawStore.set('1', { id: '1', title: 'Item 1', amount: 100 });
    await rawStore.set('2', { id: '2', title: 'Item 2', amount: 200 });

    const result = await execute(source, {
      dryRun: false,
      verbose: false,
      stores: { raw: rawStore },
    });

    expect(result.success).toBe(true);
    expect(result.actionsRun).toContain('Process');

    // Check processed store
    const processedStore = result.stores.get('processed');
    expect(processedStore).toBeDefined();

    const items = await processedStore!.list();
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ id: '1', name: 'Item 1', value: 100 });
  });

  // TODO: Xero example uses object literals in `body: {...}` which require
  // Vague to support object literal parsing. Skipping until that feature is added.
  it.skip('parses the Xero example file', async () => {
    const fs = await import('node:fs/promises');
    const source = await fs.readFile('./examples/xero/invoices.vague', 'utf-8');

    const program = parse(source);

    expect(program.type).toBe('ReqonProgram');
    expect(program.statements).toHaveLength(1);

    const mission = program.statements[0];
    if (mission.type === 'MissionDefinition') {
      expect(mission.name).toBe('SyncXeroInvoices');
      expect(mission.sources).toHaveLength(1);
      expect(mission.stores).toHaveLength(2);
      expect(mission.actions).toHaveLength(3);
      expect(mission.pipeline.stages).toHaveLength(3);
    }
  });

  it('handles validation failures gracefully', async () => {
    const source = `
      mission ValidationTest {
        source API {
          auth: bearer,
          base: "https://api.example.com"
        }

        store items: memory("items")

        action Validate {
          for item in items {
            validate item {
              assume .value > 0
            }
          }
        }

        run Validate
      }
    `;

    const itemsStore = new MemoryStore('items');
    await itemsStore.set('1', { id: '1', value: -5 }); // Invalid: negative value

    const result = await execute(source, {
      stores: { items: itemsStore },
    });

    // Validation should fail
    expect(result.success).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('processes match expressions in map steps', async () => {
    const source = `
      mission MatchTest {
        source API {
          auth: bearer,
          base: "https://api.example.com"
        }

        store input: memory("input")
        store output: memory("output")

        action Transform {
          for item in input {
            map item -> Output {
              id: .id,
              status: match .state {
                "A" => "active",
                "I" => "inactive",
                _ => "unknown"
              }
            }

            store response -> output {
              key: .id
            }
          }
        }

        run Transform
      }
    `;

    const inputStore = new MemoryStore('input');
    await inputStore.set('1', { id: '1', state: 'A' });
    await inputStore.set('2', { id: '2', state: 'I' });
    await inputStore.set('3', { id: '3', state: 'X' });

    const result = await execute(source, {
      stores: { input: inputStore },
    });

    expect(result.success).toBe(true);

    const outputStore = result.stores.get('output');
    const items = await outputStore!.list();

    expect(items).toContainEqual(expect.objectContaining({ id: '1', status: 'active' }));
    expect(items).toContainEqual(expect.objectContaining({ id: '2', status: 'inactive' }));
    expect(items).toContainEqual(expect.objectContaining({ id: '3', status: 'unknown' }));
  });
});
