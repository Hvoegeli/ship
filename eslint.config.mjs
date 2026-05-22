// Cat-1 / S9: a real ESLint gate. Previously `pnpm lint` ran `pnpm -r run lint`
// but NO package defined a lint script and ESLint wasn't installed — it silently
// passed, presenting the appearance of static-analysis coverage (S9). This flat
// config installs the type-safety "escape hatch" rules the audit calls out:
// explicit `any`, non-null assertions (`!`), and unsafe type assertions (`as`).
//
// Rules are "warn" (not "error") so the gate RUNS and REPORTS against the ~619
// existing violations without failing the build; the durable win is that it
// makes new violations visible in review. Tighten to "error" on changed files
// via lint-staged once the backlog is burned down.
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/*.config.{js,mjs,ts}',
      'scripts/**',
      'e2e/**',
    ],
  },
  {
    files: ['api/src/**/*.{ts,tsx}', 'web/src/**/*.{ts,tsx}', 'shared/src/**/*.{ts,tsx}'],
    ignores: ['**/*.test.ts', '**/*.test.tsx', '**/__tests__/**'],
    plugins: { '@typescript-eslint': tseslint.plugin },
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-non-null-assertion': 'warn',
      '@typescript-eslint/consistent-type-assertions': [
        'warn',
        { assertionStyle: 'as', objectLiteralTypeAssertions: 'allow-as-parameter' },
      ],
    },
  }
);
