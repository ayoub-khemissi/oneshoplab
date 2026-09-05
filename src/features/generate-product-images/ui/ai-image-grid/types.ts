export type ImageAngle =
  'lifestyle' | 'studio' | 'inuse' | 'packshot' | 'flatlay' | 'macro' | 'scale' | 'gift' | 'custom';

export type BusyKind = 'delete' | 'regenerate';

export interface NewImagePayload {
  angle: ImageAngle;
  customPrompt: string;
}
