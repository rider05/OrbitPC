/** Shared validation/formatting for incoming screen.frame envelopes. */
export interface ScreenFrameMsg {
  computerId: string;
  format: 'png' | 'jpeg';
  seq?: number;
  capturedAt?: string;
  frameBase64: string;
}

export function isValidScreenFrame(msg: unknown): msg is ScreenFrameMsg {
  const f = msg as ScreenFrameMsg | null;
  return !!f && typeof f.computerId === 'string' && typeof f.frameBase64 === 'string' && (f.format === 'png' || f.format === 'jpeg');
}

export function frameUri(format: 'png' | 'jpeg', frameBase64: string): string {
  return `data:image/${format};base64,${frameBase64}`;
}
