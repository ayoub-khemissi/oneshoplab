/**
 * Deterministic fixtures for the smoke tests. Everything here is created by
 * global-setup against the `<db>_test` database.
 */
export const SEED = {
  user: { email: 'e2e@test.local', password: 'e2e-password-123', name: 'E2E User' },
  project: { id: '11111111-1111-4111-8111-111111111111', domain: 'demo-shop.example.com' },
  shareLinkId: '22222222-2222-4222-8222-222222222222',
  revokedShareLinkId: '33333333-3333-4333-8333-333333333333',
  anonAuditToken: '44444444-4444-4444-8444-444444444444',
  /** A store that reported image-ops capabilities (docs/api/IMAGE-OPS.md §7),
   *  kept apart from `project` so the other specs keep the minimum ones. */
  imageProject: { id: '55555555-5555-4555-8555-555555555555', domain: 'photo-shop.example.com' },
  imageProduct: {
    id: '66666666-6666-4666-8666-666666666666',
    sourceId: 'photo-1',
    imageIds: ['m1', 'm2', 'm3']
  },
  /** A store with changes still waiting: two pending + one the store refused,
   *  which the modal can send again (it carries a completed source job). */
  pendingProject: { id: '77777777-7777-4777-8777-777777777777', domain: 'pending-shop.example.com' },
  pendingProduct: { id: '88888888-8888-4888-8888-888888888888', sourceId: 'pending-mug' },
  pendingChanges: {
    /** ULIDs sort by time — these three stay below anything created at runtime. */
    title: '01KPEND0000000000000000001',
    description: '01KPEND0000000000000000002',
    failedTags: '01KBAD00000000000000000001',
    failedJobId: '99999999-9999-4999-8999-999999999999'
  }
} as const;
