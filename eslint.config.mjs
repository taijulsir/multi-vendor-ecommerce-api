// @ts-check
import eslint from '@eslint/js';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['eslint.config.mjs'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  eslintPluginPrettierRecommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
      sourceType: 'commonjs',
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-floating-promises': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      "prettier/prettier": ["error", { endOfLine: "auto" }],
    },
  },
  {
    // Every *.spec.ts/*.e2e-spec.ts file in this codebase consistently
    // uses a small set of test-only patterns that `recommendedTypeChecked`
    // is (correctly, for production code) strict about but that are
    // deliberate and accepted here, not defects:
    //  - `new XyzService(mockDep as any)` manual mocking (no DI container)
    //    and asserting against supertest's untyped `response.body`
    //    → no-unsafe-*
    //  - `Reflector.get(KEY, TestController.prototype.handler)` — bare
    //    method references into reflection-testing helper classes that
    //    never use `this` → unbound-method
    //  - `jest.fn(async (callback) => callback(tx))`-style transaction
    //    mocks, where the wrapped callback is itself the async work
    //    → require-await
    // Kept fully enforced for real application code under `src/`
    // (excluding test files).
    files: ['**/*.spec.ts', 'test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/unbound-method': 'off',
      '@typescript-eslint/require-await': 'off',
    },
  },
);
