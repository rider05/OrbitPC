import { describe, expect, it } from 'vitest';
import { frameUri, isValidScreenFrame, type ScreenFrameMsg } from './screen-frame';

describe('screen frame helper', () => {
  it('accepts a valid frame envelope', () => {
    const f: ScreenFrameMsg = { computerId: 'abc', format: 'jpeg', frameBase64: 'AA==' };
    expect(isValidScreenFrame(f)).toBe(true);
  });

  it('rejects malformed frames', () => {
    expect(isValidScreenFrame(null)).toBe(false);
    expect(isValidScreenFrame({ computerId: 123 })).toBe(false);
    expect(isValidScreenFrame({ computerId: 'x', format: 'bmp', frameBase64: 'a' })).toBe(false);
    expect(isValidScreenFrame({ computerId: 'x', format: 'jpeg' })).toBe(false);
  });

  it('frameUri wraps base64 into a data URI', () => {
    expect(frameUri('jpeg', 'AA==')).toBe('data:image/jpeg;base64,AA==');
    expect(frameUri('png', 'BB==')).toBe('data:image/png;base64,BB==');
  });
});
