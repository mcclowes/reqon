import SwaggerParser from '@apidevtools/swagger-parser';
import type { OpenAPIV3, OpenAPIV3_1 } from 'openapi-types';

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

export interface LoadOASOptions {
  /** Bypass the spec cache and re-parse. */
  forceReload?: boolean;
  /**
   * Allow `$ref` pointers to external documents, including remote http(s)
   * URLs. Off by default: an OAS spec is often untrusted input, and resolving
   * external $refs lets the parser fetch arbitrary hosts/files — an SSRF and
   * resource-exhaustion sink. When false, only internal `#/...` references are
   * resolved; external ones are not fetched.
   */
  allowExternalRefs?: boolean;
}

export async function loadOAS(
  specPath: string,
  optionsOrForceReload: LoadOASOptions | boolean = {}
): Promise<OASSource> {
  // Back-compat: a bare boolean used to mean `forceReload`.
  const options: LoadOASOptions =
    typeof optionsOrForceReload === 'boolean'
      ? { forceReload: optionsOrForceReload }
      : optionsOrForceReload;
  const { forceReload = false, allowExternalRefs = false } = options;

  if (!forceReload && specCache.has(specPath)) {
    return specCache.get(specPath)!;
  }

  // Default-deny external reference resolution to prevent SSRF / remote fetches.
  const parserOptions = allowExternalRefs ? {} : { resolve: { external: false } };
  const api = (await SwaggerParser.dereference(specPath, parserOptions)) as OpenAPISpec;

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
    return resolveServerUrl(spec.servers[0]);
  }
  return '';
}

/**
 * Resolve `{variable}` templating in a server URL using each variable's
 * declared default. A template variable with no default is rejected rather
 * than left raw (a raw `{var}` would otherwise be sent as part of request
 * URLs).
 */
function resolveServerUrl(server: OpenAPIV3.ServerObject): string {
  return server.url.replace(/\{([^{}]+)\}/g, (_match, name: string) => {
    const variable = server.variables?.[name];
    if (variable && variable.default !== undefined && variable.default !== '') {
      return String(variable.default);
    }
    throw new Error(
      `OAS server URL variable '{${name}}' has no default value (in "${server.url}")`
    );
  });
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
    throw new Error(`Operation '${operationId}' not found in OAS spec. Available: ${available}...`);
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
