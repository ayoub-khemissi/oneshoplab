// Staged-file hooks. ESLint here blocks on ERRORS only: the codebase carries
// a ratchet of legacy warnings (see docs/ADOPTION.md) and `--max-warnings=0`
// would freeze every commit that touches one of those files. The 0-warning
// target is `pnpm lint:strict`.
const lintStagedConfig = {
  '*.{ts,tsx,mjs,cjs,js}': ['prettier --write', 'eslint --fix'],
  '*.{json,css,yml,yaml}': ['prettier --write'],
  'messages/*.json': () => 'node scripts/check-i18n.mjs'
};

export default lintStagedConfig;
