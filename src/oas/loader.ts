import SwaggerParser from '@apidevtools/swagger-parser';
import type { OpenAPI, OpenAPIV3, OpenAPIV3_1 } from 'openapi-types';

export type OpenAPISpec = OpenAPIV3.Document | OpenAPIV3_1.Document;

export interface OASOperation {
  operationId: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  parameters?: OpenAPIV3.ParameterObject[];
  requestBody?: OpenAPIV3.RequestBodyObject;
  responses?: OpenAPIV3.ResponsesObject;
  security?: OpenAPIV3.SecurityRequirementObject[];
}

export interface OASSource {
  spec: OpenAPISpec;
  baseUrl: string;
  operations: Map<string, OASOperation>;
  schemas: Map<string, OpenAPIV3.SchemaObject>;
}

// Cache loaded specs to avoid re-parsing
const specCache = new Map<string, OASSource>();

export async function loadOAS(specPath: string, forceReload = false): Promise<OASSource> {
  if (!forceReload && specCache.has(specPath)) {
    return specCache.get(specPath)!;
  }

  const api = await SwaggerParser.dereference(specPath) as OpenAPISpec;

  const baseUrl = extractBaseUrl(api);
  const operations = extractOperations(api);
  const schemas = extractSchemas(api);

  const source: OASSource = {
    spec: api,
    baseUrl,
    operations,
    schemas,
  };

  specCache.set(specPath, source);
  return source;
}

function extractBaseUrl(spec: OpenAPISpec): string {
  if (spec.servers && spec.servers.length > 0) {
    return spec.servers[0].url;
  }
  return '';
}

function extractOperations(spec: OpenAPISpec): Map<string, OASOperation> {
  const operations = new Map<string, OASOperation>();

  if (!spec.paths) return operations;

  for (const [path, pathItem] of Object.entries(spec.paths)) {
    if (!pathItem) continue;

    const methods = ['get', 'post', 'put', 'patch', 'delete'] as const;

    for (const method of methods) {
      const operation = pathItem[method] as OpenAPIV3.OperationObject | undefined;
      if (!operation?.operationId) continue;

      operations.set(operation.operationId, {
        operationId: operation.operationId,
        method: method.toUpperCase() as OASOperation['method'],
        path,
        parameters: operation.parameters as OpenAPIV3.ParameterObject[],
        requestBody: operation.requestBody as OpenAPIV3.RequestBodyObject,
        responses: operation.responses as OpenAPIV3.ResponsesObject,
        security: operation.security,
      });
    }
  }

  return operations;
}

function extractSchemas(spec: OpenAPISpec): Map<string, OpenAPIV3.SchemaObject> {
  const schemas = new Map<string, OpenAPIV3.SchemaObject>();

  const components = spec.components;
  if (!components?.schemas) return schemas;

  for (const [name, schema] of Object.entries(components.schemas)) {
    schemas.set(name, schema as OpenAPIV3.SchemaObject);
  }

  return schemas;
}

export function resolveOperation(source: OASSource, operationId: string): OASOperation {
  const operation = source.operations.get(operationId);
  if (!operation) {
    const available = Array.from(source.operations.keys()).slice(0, 5).join(', ');
    throw new Error(
      `Operation '${operationId}' not found in OAS spec. Available: ${available}...`
    );
  }
  return operation;
}

export function getResponseSchema(
  source: OASSource,
  operationId: string,
  statusCode = '200'
): OpenAPIV3.SchemaObject | undefined {
  const operation = resolveOperation(source, operationId);

  const response = operation.responses?.[statusCode] as OpenAPIV3.ResponseObject | undefined;
  if (!response?.content) return undefined;

  const jsonContent = response.content['application/json'];
  if (!jsonContent?.schema) return undefined;

  return jsonContent.schema as OpenAPIV3.SchemaObject;
}

export function clearCache(): void {
  specCache.clear();
}
