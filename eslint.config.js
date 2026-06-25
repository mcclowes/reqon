import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Benchmarks are standalone tsx scripts outside the typecheck project
    // (excluded from tsconfig), so the type-aware linter can't resolve them.
    ignores: ['dist/**', 'node_modules/**', 'src/benchmark/**'],
  },
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Enforce consistent type assertions
      '@typescript-eslint/consistent-type-assertions': [
        'warn',
        { assertionStyle: 'as', objectLiteralTypeAssertions: 'allow-as-parameter' },
      ],
      // Warn on explicit any usage
      '@typescript-eslint/no-explicit-any': 'warn',
      // Allow unused vars with underscore prefix
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // Prefer nullish coalescing
      '@typescript-eslint/prefer-nullish-coalescing': 'off',
      // Consistent return types
      '@typescript-eslint/explicit-function-return-type': 'off',
      // Allow non-null assertions sparingly
      '@typescript-eslint/no-non-null-assertion': 'warn',
    },
  },
  {
    // Tests legitimately use mock casts and non-null assertions to build
    // fixtures; keep these as warnings rather than hard errors.
    files: ['**/*.test.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-non-null-assertion': 'warn',
    },
  }
);
