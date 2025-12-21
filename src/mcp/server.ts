#!/usr/bin/env node
/**
 * Reqon MCP Server
 *
 * Exposes Reqon pipeline capabilities via the Model Context Protocol.
 *
 * Tools:
 * - reqon.execute: Execute a mission from DSL source
 * - reqon.execute_file: Execute a mission from a file/folder path
 * - reqon.query_store: Query data from a named store
 * - reqon.list_stores: List available stores
 *
 * Resources:
 * - reqon://stores - List all stores
 * - reqon://stores/{name} - Access store data
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  type Tool,
  type Resource,
} from '@modelcontextprotocol/sdk/types.js';

import { parse, execute, fromPath } from '../index.js';
import {
  createStore,
  type StoreAdapter,
  type StoreFilter,
} from '../stores/index.js';
import type { ExecutorConfig, ExecutionResult } from '../interpreter/index.js';

// Global store registry for cross-execution access
const storeRegistry = new Map<string, StoreAdapter>();

// Server configuration
interface ServerConfig {
  workingDirectory?: string;
  verbose?: boolean;
}

let serverConfig: ServerConfig = {
  workingDirectory: process.cwd(),
  verbose: false,
};

/**
 * Format execution result for MCP response
 */
function formatExecutionResult(result: ExecutionResult): string {
  const output: Record<string, unknown> = {
    success: result.success,
    duration: result.duration,
    actionsRun: result.actionsRun,
  };

  if (result.errors && result.errors.length > 0) {
    output.errors = result.errors.map((e) => ({
      action: e.action,
      step: e.step,
      message: e.message,
    }));
  }

  // Include store summaries
  if (result.stores && result.stores.size > 0) {
    output.stores = Array.from(result.stores.keys());
  }

  if (result.executionId) {
    output.executionId = result.executionId;
  }

  return JSON.stringify(output, null, 2);
}

/**
 * Create executor config
 */
function createExecutorConfig(options?: {
  verbose?: boolean;
  dryRun?: boolean;
}): ExecutorConfig {
  return {
    verbose: options?.verbose ?? serverConfig.verbose,
    dryRun: options?.dryRun ?? false,
  };
}

// Define available tools
const tools: Tool[] = [
  {
    name: 'reqon.execute',
    description:
      'Execute a Reqon mission from DSL source code. Returns execution results including any stored data.',
    inputSchema: {
      type: 'object',
      properties: {
        source: {
          type: 'string',
          description: 'Reqon DSL source code defining the mission',
        },
        verbose: {
          type: 'boolean',
          description: 'Enable verbose logging',
          default: false,
        },
        dryRun: {
          type: 'boolean',
          description: 'Validate without executing HTTP requests',
          default: false,
        },
      },
      required: ['source'],
    },
  },
  {
    name: 'reqon.execute_file',
    description:
      'Execute a Reqon mission from a file or folder path. Supports both single .reqon files and mission folders.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description:
            'Path to .reqon file or mission folder (relative to working directory)',
        },
        verbose: {
          type: 'boolean',
          description: 'Enable verbose logging',
          default: false,
        },
        dryRun: {
          type: 'boolean',
          description: 'Validate without executing HTTP requests',
          default: false,
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'reqon.parse',
    description:
      'Parse Reqon DSL source and return the AST structure. Useful for validation without execution.',
    inputSchema: {
      type: 'object',
      properties: {
        source: {
          type: 'string',
          description: 'Reqon DSL source code to parse',
        },
      },
      required: ['source'],
    },
  },
  {
    name: 'reqon.query_store',
    description:
      'Query data from a registered Reqon store. Returns matching records.',
    inputSchema: {
      type: 'object',
      properties: {
        store: {
          type: 'string',
          description: 'Name of the store to query',
        },
        filter: {
          type: 'object',
          description: 'Filter criteria',
          properties: {
            where: {
              type: 'object',
              description: 'Field equality conditions',
            },
            limit: {
              type: 'number',
              description: 'Maximum records to return',
            },
            offset: {
              type: 'number',
              description: 'Number of records to skip',
            },
          },
        },
      },
      required: ['store'],
    },
  },
  {
    name: 'reqon.list_stores',
    description:
      'List all registered stores and their record counts.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'reqon.register_store',
    description:
      'Register a store for use across executions. Stores persist in memory during the server session.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Store name for reference',
        },
        type: {
          type: 'string',
          enum: ['memory', 'file'],
          description: 'Store type',
          default: 'memory',
        },
        path: {
          type: 'string',
          description: 'File path for file-based stores',
        },
      },
      required: ['name'],
    },
  },
];

// Create server instance
const server = new Server(
  {
    name: 'reqon-mcp-server',
    version: '0.1.0',
  },
  {
    capabilities: {
      tools: {},
      resources: {},
    },
  }
);

// Handle tool listing
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools };
});

// Handle tool execution
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'reqon.execute': {
        const { source, verbose, dryRun } = args as {
          source: string;
          verbose?: boolean;
          dryRun?: boolean;
        };

        const config = createExecutorConfig({ verbose, dryRun });
        const result = await execute(source, config);

        return {
          content: [
            {
              type: 'text',
              text: formatExecutionResult(result),
            },
          ],
        };
      }

      case 'reqon.execute_file': {
        const { path, verbose, dryRun } = args as {
          path: string;
          verbose?: boolean;
          dryRun?: boolean;
        };

        const config = createExecutorConfig({ verbose, dryRun });
        const result = await fromPath(path, config);

        return {
          content: [
            {
              type: 'text',
              text: formatExecutionResult(result),
            },
          ],
        };
      }

      case 'reqon.parse': {
        const { source } = args as { source: string };

        const program = parse(source);

        // Summarize AST for readability
        const summary = {
          type: 'ReqonProgram',
          statements: program.statements.length,
          missions: program.statements
            .filter((s) => s.type === 'MissionDefinition')
            .map((m: any) => ({
              name: m.name,
              sources: m.sources?.length ?? 0,
              stores: m.stores?.length ?? 0,
              actions: m.actions?.length ?? 0,
              hasSchedule: !!m.schedule,
            })),
        };

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(summary, null, 2),
            },
          ],
        };
      }

      case 'reqon.query_store': {
        const { store: storeName, filter } = args as {
          store: string;
          filter?: StoreFilter;
        };

        const store = storeRegistry.get(storeName);
        if (!store) {
          return {
            isError: true,
            content: [
              {
                type: 'text',
                text: `Store "${storeName}" not found. Available stores: ${
                  Array.from(storeRegistry.keys()).join(', ') || '(none)'
                }`,
              },
            ],
          };
        }

        const records = await store.list(filter);
        const count = await store.count(filter);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  store: storeName,
                  totalMatching: count,
                  returned: records.length,
                  data: records,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case 'reqon.list_stores': {
        const stores: Array<{ name: string; count: number }> = [];

        for (const [name, store] of storeRegistry) {
          const count = await store.count();
          stores.push({ name, count });
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  stores,
                  total: stores.length,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case 'reqon.register_store': {
        const { name, type = 'memory', path } = args as {
          name: string;
          type?: 'memory' | 'file';
          path?: string;
        };

        if (storeRegistry.has(name)) {
          return {
            content: [
              {
                type: 'text',
                text: `Store "${name}" already registered`,
              },
            ],
          };
        }

        const store = createStore({
          type,
          name,
          baseDir: path ?? '.reqon-data',
        });

        storeRegistry.set(name, store);

        return {
          content: [
            {
              type: 'text',
              text: `Store "${name}" registered (type: ${type})`,
            },
          ],
        };
      }

      default:
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `Unknown tool: ${name}`,
            },
          ],
        };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text: `Error: ${message}`,
        },
      ],
    };
  }
});

// Handle resource listing
server.setRequestHandler(ListResourcesRequestSchema, async () => {
  const resources: Resource[] = [
    {
      uri: 'reqon://stores',
      name: 'Reqon Stores',
      description: 'List of all registered data stores',
      mimeType: 'application/json',
    },
  ];

  // Add individual store resources
  for (const name of storeRegistry.keys()) {
    resources.push({
      uri: `reqon://stores/${name}`,
      name: `Store: ${name}`,
      description: `Data from the "${name}" store`,
      mimeType: 'application/json',
    });
  }

  return { resources };
});

// Handle resource reading
server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const { uri } = request.params;

  if (uri === 'reqon://stores') {
    const stores: Array<{ name: string; count: number }> = [];

    for (const [name, store] of storeRegistry) {
      const count = await store.count();
      stores.push({ name, count });
    }

    return {
      contents: [
        {
          uri,
          mimeType: 'application/json',
          text: JSON.stringify(stores, null, 2),
        },
      ],
    };
  }

  const storeMatch = uri.match(/^reqon:\/\/stores\/(.+)$/);
  if (storeMatch) {
    const storeName = storeMatch[1];
    const store = storeRegistry.get(storeName);

    if (!store) {
      throw new Error(`Store "${storeName}" not found`);
    }

    const records = await store.list({ limit: 100 });
    const count = await store.count();

    return {
      contents: [
        {
          uri,
          mimeType: 'application/json',
          text: JSON.stringify(
            {
              store: storeName,
              totalRecords: count,
              data: records,
            },
            null,
            2
          ),
        },
      ],
    };
  }

  throw new Error(`Resource not found: ${uri}`);
});

// Start server
async function main() {
  // Parse CLI arguments
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--verbose' || args[i] === '-v') {
      serverConfig.verbose = true;
    }
    if (args[i] === '--cwd' && args[i + 1]) {
      serverConfig.workingDirectory = args[++i];
      process.chdir(serverConfig.workingDirectory);
    }
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Log to stderr so it doesn't interfere with MCP protocol on stdout
  console.error('Reqon MCP Server running on stdio');
  if (serverConfig.verbose) {
    console.error(`  Working directory: ${serverConfig.workingDirectory}`);
  }
}

main().catch((error) => {
  console.error('Server error:', error);
  process.exit(1);
});
