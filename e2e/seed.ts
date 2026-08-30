/**
 * Deterministic fixtures for the smoke tests. Everything here is created by
 * global-setup against the `<db>_test` database.
 */
export const SEED = {
  user: { email: 'e2e@test.local', password: 'e2e-password-123', name: 'E2E User' },
  project: { id: '11111111-1111-4111-8111-111111111111', domain: 'demo-shop.example.com' },
  shareLinkId: '22222222-2222-4222-8222-222222222222',
  revokedShareLinkId: '33333333-3333-4333-8333-333333333333',
  anonAuditToken: '44444444-4444-4444-8444-444444444444'
} as const;
