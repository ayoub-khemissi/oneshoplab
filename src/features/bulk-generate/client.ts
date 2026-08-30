// Client-safe entry: prefs editors only, no db/worker code (the widget's
// client components import from here, never from the server barrel).
export type { BulkFieldKey, BulkPrefs, ImageAngle } from './ui/bulk-prefs-editor';
export {
  ALL_ANGLES,
  BulkPrefsEditor,
  canonicalizePrefs,
  noFieldsSelected,
  prefsKey
} from './ui/bulk-prefs-editor';
export { SiteBulkPrefsEditor } from './ui/site-bulk-prefs-editor';
