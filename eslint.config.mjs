import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
import unusedImports from 'eslint-plugin-unused-imports';

// eslint-config-next registers eslint-plugin-react-hooks inside its own
// config objects; overriding one of its rules requires the plugin to be
// declared in the SAME object, so we borrow the instance it already loaded
// (pnpm's strict node_modules makes it non-importable from here).
const reactHooksPlugin = nextVitals
  .map((c) => c.plugins?.['react-hooks'])
  .find(Boolean);

/**
 * ESLint flat config (Next 16 removed `next lint`; this replaces it).
 *
 * Quality gate policy — mirrors what worked on a sibling project:
 *   - MUST (error): no `any`, no unused imports, no stray console.log
 *     (warn/error are allowed: they are the logger here), no ts-ignore.
 *   - `max-lines` starts as a WARNING with a generous ceiling so the
 *     existing oversized files surface in the report without blocking;
 *     it flips to error (300) once the known monsters are split.
 *   - scripts/, tooling and generated dirs are out of scope: they are
 *     operator tools, not product code.
 */
const eslintConfig = [
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'drizzle/**',
      'remotion-ads/**',
      'tools/**',
      'legacy/**',
      'scripts/**',
      'deploy/**',
      'next-env.d.ts',
      'public/**'
    ]
  },
  ...nextVitals,
  ...nextTs,
  {
    plugins: { 'unused-imports': unusedImports, ...(reactHooksPlugin ? { 'react-hooks': reactHooksPlugin } : {}) },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/ban-ts-comment': ['error', { 'ts-expect-error': 'allow-with-description' }],
      '@typescript-eslint/no-unused-vars': 'off',
      'unused-imports/no-unused-imports': 'error',
      'unused-imports/no-unused-vars': [
        'warn',
        { vars: 'all', varsIgnorePattern: '^_', args: 'after-used', argsIgnorePattern: '^_' }
      ],
      'no-console': ['error', { allow: ['warn', 'error', 'info'] }],
      // React Compiler-era hook rules (set-state-in-effect, refs, purity):
      // 25 legacy hits, each a real but non-trivial refactor (prop→state
      // sync effects, elapsed-time refs). Ratchet: WARN now, tracked in
      // docs/ADOPTION.md, flip to error once the count reaches 0.
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/purity': 'warn',
      'max-lines': ['warn', { max: 600, skipBlankLines: true, skipComments: true }]
    }
  },
  {
    // Worker + server-only libs log operational lines with console.log on
    // purpose (PM2 captures stdout); they are not UI code.
    files: ['src/worker/**', 'src/lib/cold/**'],
    rules: { 'no-console': 'off' }
  }
];

export default eslintConfig;
