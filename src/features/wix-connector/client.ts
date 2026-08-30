// Client-safe entry: UI + types only (index.ts opens the db).
export { WixConnectionCard } from './ui/wix-connection-card';
export { WixInstallButton } from './ui/wix-install-button';
export type { WixActionError, WixActionResult } from './api/actions';
export type { WixConnectionView } from '@/entities/shop-connection/client';
