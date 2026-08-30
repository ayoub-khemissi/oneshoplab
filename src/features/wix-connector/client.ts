// Client-safe entry: types only (index.ts opens the db). UI components are the wizard agent's.
export type { WixActionError, WixActionResult } from './api/actions';
export type { WixConnectionView } from '@/entities/shop-connection/client';
