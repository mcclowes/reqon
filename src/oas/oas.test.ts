import { describe, it, expect, beforeAll } from 'vitest';
import { loadOAS, resolveOperation, getResponseSchema, clearCache } from './loader.js';
import { validateResponse } from './validator.js';
import { ReqonLexer } from '../lexer/index.js';
import { ReqonParser } from '../parser/parser.js';

describe('OAS Loader', () => {
  beforeAll(() => {
    clearCache();
  });

  it('loads and parses an OpenAPI spec', async () => {
    const source = await loadOAS('./examples/petstore/openapi.yaml');

    expect(source.baseUrl).toBe('https://api.petstore.example.com/v1');
    expect(source.operations.size).toBe(3);
    expect(source.schemas.size).toBe(2);
  });

  it('resolves operations by operationId', async () => {
    const source = await loadOAS('./examples/petstore/openapi.yaml');

    const listPets = resolveOperation(source, 'listPets');
    expect(listPets.method).toBe('GET');
    expect(listPets.path).toBe('/pets');

    const getPet = resolveOperation(source, 'getPet');
    expect(getPet.method).toBe('GET');
    expect(getPet.path).toBe('/pets/{petId}');

    const createPet = resolveOperation(source, 'createPet');
    expect(createPet.method).toBe('POST');
    expect(createPet.path).toBe('/pets');
  });

  it('throws for unknown operationId', async () => {
    const source = await loadOAS('./examples/petstore/openapi.yaml');

    expect(() => resolveOperation(source, 'unknownOp')).toThrow(/not found/);
  });

  it('extracts response schemas', async () => {
    const source = await loadOAS('./examples/petstore/openapi.yaml');

    const schema = getResponseSchema(source, 'getPet');
    expect(schema).toBeDefined();
    expect(schema?.type).toBe('object');
    expect(schema?.properties).toHaveProperty('id');
    expect(schema?.properties).toHaveProperty('name');
  });
});

describe('OAS Validator', () => {
  it('validates a valid response', () => {
    const schema = {
      type: 'object' as const,
      required: ['id', 'name'],
      properties: {
        id: { type: 'string' as const },
        name: { type: 'string' as const },
        age: { type: 'integer' as const, minimum: 0 },
      },
    };

    const data = { id: '123', name: 'Fluffy', age: 3 };
    const result = validateResponse(data, schema);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('catches missing required properties', () => {
    const schema = {
      type: 'object' as const,
      required: ['id', 'name'],
      properties: {
        id: { type: 'string' as const },
        name: { type: 'string' as const },
      },
    };

    const data = { id: '123' }; // missing 'name'
    const result = validateResponse(data, schema);

    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.path === 'name')).toBe(true);
  });

  it('catches type mismatches', () => {
    const schema = {
      type: 'object' as const,
      properties: {
        age: { type: 'integer' as const },
      },
    };

    const data = { age: 'not a number' };
    const result = validateResponse(data, schema);

    expect(result.valid).toBe(false);
    expect(result.errors[0].path).toBe('age');
  });

  it('validates arrays', () => {
    const schema = {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        required: ['id'],
        properties: {
          id: { type: 'string' as const },
        },
      },
    };

    const validData = [{ id: '1' }, { id: '2' }];
    expect(validateResponse(validData, schema).valid).toBe(true);

    const invalidData = [{ id: '1' }, { noId: true }];
    const result = validateResponse(invalidData, schema);
    expect(result.valid).toBe(false);
    expect(result.errors[0].path).toBe('[1].id');
  });
});

describe('OAS Parser Integration', () => {
  function parse(source: string) {
    const lexer = new ReqonLexer(source);
    const tokens = lexer.tokenize();
    const parser = new ReqonParser(tokens);
    return parser.parse();
  }

  it('parses source with OAS spec path', () => {
    const source = `
      mission TestOAS {
        source Petstore from "./examples/petstore.yaml" {
          auth: bearer
        }

        store pets: memory("pets")

        action FetchPets {
          fetch Petstore.listPets

          store response.pets -> pets {
            key: .id
          }
        }

        run FetchPets
      }
    `;

    const program = parse(source);
    expect(program.type).toBe('ReqonProgram');

    const mission = program.statements[0];
    if (mission.type === 'MissionDefinition') {
      expect(mission.sources[0].specPath).toBe('./examples/petstore.yaml');
      expect(mission.sources[0].config.base).toBeUndefined();

      const action = mission.actions[0];
      const fetchStep = action.steps[0];
      if (fetchStep.type === 'FetchStep') {
        expect(fetchStep.operationRef).toBeDefined();
        expect(fetchStep.operationRef?.source).toBe('Petstore');
        expect(fetchStep.operationRef?.operationId).toBe('listPets');
        expect(fetchStep.method).toBeUndefined();
        expect(fetchStep.path).toBeUndefined();
      }
    }
  });

  it('parses source with OAS and explicit base URL override', () => {
    const source = `
      mission TestOAS {
        source Petstore from "./examples/petstore.yaml" {
          auth: bearer,
          base: "https://staging.petstore.com/v1"
        }

        store pets: memory("pets")

        action Fetch {
          fetch GET "/custom-path"
          store response -> pets { key: .id }
        }

        run Fetch
      }
    `;

    const program = parse(source);
    const mission = program.statements[0];
    if (mission.type === 'MissionDefinition') {
      expect(mission.sources[0].specPath).toBe('./examples/petstore.yaml');
      expect(mission.sources[0].config.base).toBe('https://staging.petstore.com/v1');
    }
  });

  it('supports both OAS and traditional fetch in same mission', () => {
    const source = `
      mission MixedFetch {
        source Petstore from "./examples/petstore.yaml" {
          auth: bearer
        }

        source Legacy {
          auth: bearer,
          base: "https://legacy.api.com"
        }

        store pets: memory("pets")

        action FetchFromOAS {
          fetch Petstore.listPets
          store response.pets -> pets { key: .id }
        }

        action FetchFromLegacy {
          fetch GET "/old-endpoint" {
            source: Legacy
          }
          store response -> pets { key: .id }
        }

        run FetchFromOAS then FetchFromLegacy
      }
    `;

    const program = parse(source);
    const mission = program.statements[0];
    if (mission.type === 'MissionDefinition') {
      expect(mission.sources).toHaveLength(2);

      const oasAction = mission.actions[0];
      const legacyAction = mission.actions[1];

      const oasFetch = oasAction.steps[0];
      const legacyFetch = legacyAction.steps[0];

      if (oasFetch.type === 'FetchStep' && legacyFetch.type === 'FetchStep') {
        // OAS fetch
        expect(oasFetch.operationRef).toBeDefined();
        expect(oasFetch.method).toBeUndefined();

        // Traditional fetch
        expect(legacyFetch.operationRef).toBeUndefined();
        expect(legacyFetch.method).toBe('GET');
      }
    }
  });
});
