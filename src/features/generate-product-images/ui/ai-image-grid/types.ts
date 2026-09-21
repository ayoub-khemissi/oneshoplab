export type ImageAngle =
  'packshot' | 'inuse' | 'lifestyle' | 'studio' | 'flatlay' | 'macro' | 'scale' | 'gift' | 'custom';

export type BusyKind = 'delete' | 'regenerate';

export interface NewImagePayload {
  angle: ImageAngle;
  customPrompt: string;
  /** Output ratio for THIS image. Starts at the account preference so the
   *  merchant can reframe one shot without changing their default. */
  imageFormatId: string;
}
