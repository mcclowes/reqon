import { describe, it, expect } from 'vitest';
import { ReqonLexer } from '../lexer/index.js';
import { ReqonParser } from './parser.js';
import type { TransformDefinition, MissionDefinition, ApplyStep } from '../ast/nodes.js';

function parseTransform(source: string): TransformDefinition {
  const lexer = new ReqonLexer(source);
  const tokens = lexer.tokenize();
  const parser = new ReqonParser(tokens, source);
  const program = parser.parse();
  return program.statements.find((s) => s.type === 'TransformDefinition') as TransformDefinition;
}

function parseMission(source: string): MissionDefinition {
  const lexer = new ReqonLexer(source);
  const tokens = lexer.tokenize();
  const parser = new ReqonParser(tokens, source);
  const program = parser.parse();
  return program.statements.find((s) => s.type === 'MissionDefinition') as MissionDefinition;
}

describe('Transform Parsing', () => {
  describe('simple transform syntax', () => {
    it('parses transform with explicit source schema', () => {
      const source = `
        transform ToStandard: RawItem -> StandardItem {
          id: .external_id,
          name: .title
        }
      `;
      const transform = parseTransform(source);

      expect(transform.name).toBe('ToStandard');
      expect(transform.variants).toHaveLength(1);
      expect(transform.variants[0].sourceSchema).toBe('RawItem');
      expect(transform.variants[0].targetSchema).toBe('StandardItem');
      expect(transform.variants[0].mappings).toHaveLength(2);
    });

    it('parses transform without explicit source (wildcard)', () => {
      const source = `
        transform Normalize -> StandardItem {
          id: .id,
          name: .name
        }
      `;
      const transform = parseTransform(source);

      expect(transform.name).toBe('Normalize');
      expect(transform.variants).toHaveLength(1);
      expect(transform.variants[0].sourceSchema).toBe('_');
      expect(transform.variants[0].targetSchema).toBe('StandardItem');
    });
  });

  describe('overloaded transform syntax', () => {
    it('parses transform with multiple variants', () => {
      const source = `
        transform ToUnified {
          (XeroInvoice) -> UnifiedOrder {
            id: "xero-" + .InvoiceID,
            amount: .Total
          }
          (StripeCharge) -> UnifiedOrder {
            id: "stripe-" + .id,
            amount: .amount / 100
          }
          (_) -> UnifiedOrder {
            id: .id,
            amount: .amount
          }
        }
      `;
      const transform = parseTransform(source);

      expect(transform.name).toBe('ToUnified');
      expect(transform.variants).toHaveLength(3);
      expect(transform.variants[0].sourceSchema).toBe('XeroInvoice');
      expect(transform.variants[1].sourceSchema).toBe('StripeCharge');
      expect(transform.variants[2].sourceSchema).toBe('_');
      // All variants should have the same target schema
      transform.variants.forEach((v) => {
        expect(v.targetSchema).toBe('UnifiedOrder');
      });
    });

    it('parses variant with guard condition', () => {
      const source = `
        transform Selective {
          (RawItem) where .status == "active" -> ActiveItem {
            id: .id
          }
          (_) -> InactiveItem {
            id: .id
          }
        }
      `;
      // This should fail because target schemas differ
      expect(() => parseTransform(source)).toThrow(
        /All transform variants must have the same target schema/
      );
    });

    it('parses variant with guard when target schemas match', () => {
      const source = `
        transform Selective {
          (RawItem) where .status == "active" -> Item {
            id: .id,
            active: true
          }
          (_) -> Item {
            id: .id,
            active: false
          }
        }
      `;
      const transform = parseTransform(source);

      expect(transform.variants).toHaveLength(2);
      expect(transform.variants[0].guard).toBeDefined();
      expect(transform.variants[1].guard).toBeUndefined();
    });
  });

  describe('transform in mission', () => {
    it('parses transforms within a mission', () => {
      const source = `
        mission DataSync {
          source API { auth: bearer, base: "https://api.example.com" }
          store items: memory("items")

          transform Normalize -> StandardItem {
            id: .id,
            name: .name
          }

          action Process {
            apply Normalize to response
            store response -> items { key: .id }
          }

          run Process
        }
      `;
      const mission = parseMission(source);

      expect(mission.transforms).toHaveLength(1);
      expect(mission.transforms[0].name).toBe('Normalize');
    });

    it('parses multiple transforms in mission', () => {
      const source = `
        mission MultiTransform {
          source API { auth: bearer, base: "https://api.example.com" }
          store items: memory("items")

          transform First -> TypeA { id: .id }
          transform Second -> TypeB { name: .name }

          action Process {
            apply First to response
          }

          run Process
        }
      `;
      const mission = parseMission(source);

      expect(mission.transforms).toHaveLength(2);
      expect(mission.transforms[0].name).toBe('First');
      expect(mission.transforms[1].name).toBe('Second');
    });
  });
});

describe('Apply Step Parsing', () => {
  it('parses basic apply step', () => {
    const source = `
      mission Test {
        source API { auth: bearer, base: "https://api.example.com" }
        store items: memory("items")

        transform Normalize -> StandardItem { id: .id }

        action Process {
          apply Normalize to response
        }

        run Process
      }
    `;
    const mission = parseMission(source);
    const action = mission.actions[0];
    const applyStep = action.steps[0] as ApplyStep;

    expect(applyStep.type).toBe('ApplyStep');
    expect(applyStep.transform).toBe('Normalize');
    expect(applyStep.as).toBeUndefined();
  });

  it('parses apply with as clause', () => {
    const source = `
      mission Test {
        source API { auth: bearer, base: "https://api.example.com" }
        store items: memory("items")

        transform Normalize -> StandardItem { id: .id }

        action Process {
          apply Normalize to response as normalized
        }

        run Process
      }
    `;
    const mission = parseMission(source);
    const action = mission.actions[0];
    const applyStep = action.steps[0] as ApplyStep;

    expect(applyStep.type).toBe('ApplyStep');
    expect(applyStep.transform).toBe('Normalize');
    expect(applyStep.as).toBe('normalized');
  });

  it('parses apply with expression source', () => {
    const source = `
      mission Test {
        source API { auth: bearer, base: "https://api.example.com" }
        store items: memory("items")

        transform Normalize -> StandardItem { id: .id }

        action Process {
          for item in items {
            apply Normalize to item
          }
        }

        run Process
      }
    `;
    const mission = parseMission(source);
    const action = mission.actions[0];
    expect(action.steps[0].type).toBe('ForStep');
  });
});

describe('Transform Validation', () => {
  it('rejects undefined transform reference', () => {
    const source = `
      mission Test {
        source API { auth: bearer, base: "https://api.example.com" }
        store items: memory("items")

        action Process {
          apply UndefinedTransform to response
        }

        run Process
      }
    `;
    expect(() => parseMission(source)).toThrow(/Transform 'UndefinedTransform' is not defined/);
  });

  it('provides available transforms in error message', () => {
    const source = `
      mission Test {
        source API { auth: bearer, base: "https://api.example.com" }
        store items: memory("items")

        transform ValidTransform -> Type { id: .id }

        action Process {
          apply InvalidTransform to response
        }

        run Process
      }
    `;
    expect(() => parseMission(source)).toThrow(/Available transforms: ValidTransform/);
  });
});
