// @ts-check
import eslint from '@eslint/js';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    // `src/generated/` is Prisma's own codegen output (git-ignored, never
    // committed — see .gitignore), regenerated fresh by `npx prisma
    // generate` on every install/CI run. Linting/formatting it was
    // previously unintentional (no exclusion existed): it happened to
    // pass today, but that only checks Prisma's code generator's own
    // style against this project's rules, not anything a contributor can
    // or should fix here (Phase 24 audit).
    ignores: ['eslint.config.mjs', 'src/generated/**'],
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
    //    → no-unsafe-*, no-explicit-any
    //  - `Reflector.get(KEY, TestController.prototype.handler)` — bare
    //    method references into reflection-testing helper classes that
    //    never use `this` → unbound-method
    //  - `jest.fn(async (callback) => callback(tx))`-style transaction
    //    mocks, where the wrapped callback is itself the async work
    //    → require-await
    // Kept fully enforced for real application code under `src/`
    // (excluding test files). Phase 24 audit: `no-explicit-any`,
    // `no-floating-promises`, and `no-unsafe-argument` were previously
    // downgraded globally (`off`/`warn`) — re-running with all three at
    // `recommendedTypeChecked`'s default `error` found zero violations
    // anywhere in production code under `src/`, and zero
    // `no-floating-promises`/`no-unsafe-argument` violations even in test
    // files. The only real friction was `no-explicit-any` in test files'
    // manual mocking, which belongs in this existing test-scoped
    // exemption list, not a codebase-wide downgrade.
    files: ['**/*.spec.ts', 'test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
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
