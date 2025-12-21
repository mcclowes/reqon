import type {SidebarsConfig} from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  docsSidebar: [
    'intro',
    'getting-started',
    'cli',
    {
      type: 'category',
      label: 'Core Concepts',
      link: {
        type: 'generated-index',
        title: 'Core Concepts',
        description: 'Learn about the fundamental building blocks of Reqon',
      },
      items: [
        'core-concepts/missions',
        'core-concepts/actions',
        'core-concepts/sources',
        'core-concepts/stores',
        'core-concepts/schemas',
      ],
    },
    {
      type: 'category',
      label: 'DSL Syntax',
      link: {
        type: 'generated-index',
        title: 'DSL Syntax Reference',
        description: 'Complete reference for Reqon DSL syntax',
      },
      items: [
        'dsl-syntax/fetch',
        'dsl-syntax/for-loops',
        'dsl-syntax/map',
        'dsl-syntax/validate',
        'dsl-syntax/match',
        'dsl-syntax/pipelines',
        'dsl-syntax/expressions',
      ],
    },
    {
      type: 'category',
      label: 'HTTP & Fetching',
      link: {
        type: 'generated-index',
        title: 'HTTP & Fetching',
        description: 'Learn about HTTP requests, pagination, and retry strategies',
      },
      items: [
        'http/requests',
        'http/pagination',
        'http/retry',
        'http/incremental-sync',
        'http/rate-limiting',
        'http/circuit-breaker',
      ],
    },
    {
      type: 'category',
      label: 'Authentication',
      link: {
        type: 'generated-index',
        title: 'Authentication',
        description: 'Configure authentication for API sources',
      },
      items: [
        'authentication/overview',
        'authentication/oauth2',
        'authentication/bearer',
        'authentication/api-key',
        'authentication/basic',
      ],
    },
    {
      type: 'category',
      label: 'Error Handling',
      link: {
        type: 'generated-index',
        title: 'Error Handling',
        description: 'Handle errors with flow control directives',
      },
      items: [
        'error-handling/flow-control',
        'error-handling/retry-strategies',
        'error-handling/dead-letter-queues',
      ],
    },
    {
      type: 'category',
      label: 'Store Adapters',
      link: {
        type: 'generated-index',
        title: 'Store Adapters',
        description: 'Persist data to various backends',
      },
      items: [
        'stores/overview',
        'stores/memory',
        'stores/file',
        'stores/postgrest',
        'stores/custom-adapters',
      ],
    },
    {
      type: 'category',
      label: 'OpenAPI Integration',
      link: {
        type: 'generated-index',
        title: 'OpenAPI Integration',
        description: 'Use OpenAPI specs for type-safe API calls',
      },
      items: [
        'openapi/overview',
        'openapi/loading-specs',
        'openapi/operation-calls',
        'openapi/response-validation',
      ],
    },
    {
      type: 'category',
      label: 'Scheduling',
      link: {
        type: 'generated-index',
        title: 'Scheduling',
        description: 'Schedule missions to run automatically',
      },
      items: [
        'scheduling/overview',
        'scheduling/cron',
        'scheduling/intervals',
        'scheduling/daemon-mode',
      ],
    },
    {
      type: 'category',
      label: 'Advanced Topics',
      link: {
        type: 'generated-index',
        title: 'Advanced Topics',
        description: 'Deep dive into advanced Reqon features',
      },
      items: [
        'advanced/multi-file-missions',
        'advanced/execution-state',
        'advanced/parallel-execution',
        'advanced/extending-reqon',
      ],
    },
    'examples',
    'api-reference',
  ],
};

export default sidebars;
