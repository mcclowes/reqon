import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Test file patterns
    include: ['src/**/*.test.ts'],

    // Coverage configuration
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'html'],
      reportsDirectory: './coverage',

      // Include all source files
      include: ['src/**/*.ts'],

      // Exclude test files and index re-exports
      exclude: [
        'src/**/*.test.ts',
        'src/**/index.ts',
        'src/cli.ts', // CLI is hard to test
      ],

      // Thresholds (can be made stricter over time)
      thresholds: {
        statements: 50,
        branches: 40,
        functions: 50,
        lines: 50,
      },
    },

    // Global test timeout
    testTimeout: 10000,

    // Environment
    environment: 'node',
  },
});
