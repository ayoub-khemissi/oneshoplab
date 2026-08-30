export type ImageAngle = 'lifestyle' | 'studio' | 'inuse' | 'custom';

export type BusyKind = 'delete' | 'regenerate';

export interface NewImagePayload {
  angle: ImageAngle;
  customPrompt: string;
}
