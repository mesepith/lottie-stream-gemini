// src/audioUtils.js

/*
  * Utility functions for audio processing
*/
export function floatTo16BitPCM(float32) {
  const out = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

export function downsampleTo16k(float32, inRate) {
  const outRate = 16000;
  if (inRate === outRate) return float32;
  const ratio = inRate / outRate;
  const newLen = Math.floor(float32.length / ratio);
  const out = new Float32Array(newLen);
  let pos = 0;
  for (let i = 0; i < newLen; i++, pos += ratio) {
    out[i] = float32[Math.floor(pos)];
  }
  return out;
}

export function arrayBufferToBase64(ab) {
  const bytes = new Uint8Array(ab);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

export function base64ToInt16(b64) {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return new Int16Array(bytes.buffer);
}