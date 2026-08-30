// Client-safe entry: re-exports ONLY the slice's 'use server' modules (the
// directive lives in those files, so the actions stay references here). Client components in other slices
// import `@/features/<slice>/actions` — never the barrel, which also
// re-exports server modules (db, Stripe, next/headers) that must not enter
// the client graph. See src/shared/README.md.
export * from './api/prefs-actions';
