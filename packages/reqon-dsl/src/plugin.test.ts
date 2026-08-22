import { describe, expect, it } from 'vitest';
import { Lexer, Parser } from 'vague-lang';
import { reqonPlugin } from './plugin.js';
import type { MissionDefinition } from './ast/nodes.js';

describe('Reqon Vague plugin', () => {
  it('registers mission statement parsing with Vague', () => {
    expect(reqonPlugin.statements).toHaveProperty('MISSION');

    const source = `
      mission ImportCustomers {
        schema Customer { id: unique string }
        action Load { let result = 1 }
        run Load
      }
    `;
    const program = new Parser(new Lexer(source).tokenize(), source).parse();
    const mission = program.statements[0] as unknown as MissionDefinition;

    expect(mission.type).toBe('MissionDefinition');
    expect(mission.name).toBe('ImportCustomers');
    expect(mission.schemas[0].fields[0]).toMatchObject({ name: 'id', unique: true });
    expect(mission.pipeline.stages).toEqual([{ action: 'Load', condition: undefined }]);
  });
});
