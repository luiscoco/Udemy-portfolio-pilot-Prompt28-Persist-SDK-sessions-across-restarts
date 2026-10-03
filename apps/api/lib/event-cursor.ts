import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { eventCursorSchema } from '@portfolio-pilot/contracts';
import { parseServerConfig } from '@portfolio-pilot/config/server';

export type Positions = { user: string; market: string };
// Route bundles and development hot reloads must share the same process-local fallback key.
const keySlot = Symbol.for('portfolio-pilot.sse-development-key');
const processKeys = globalThis as typeof globalThis & { [keySlot]?: string };
const developmentKey = processKeys[keySlot] ??= randomBytes(32).toString('hex');
export function cursorCodec(secret = parseServerConfig(process.env).AUTH_SECRET ?? developmentKey) {
  const mac = (owner: string, body: string) => createHmac('sha256', secret).update(`sse-v1\n${owner}\n${body}`).digest();
  return {
    encode(owner: string, positions: Positions): string {
      const body = Buffer.from(JSON.stringify(positions)).toString('base64url');
      return `s1.${body}.${mac(owner, body).toString('base64url')}`;
    },
    decode(owner: string, cursor: string): Positions | null {
      if (cursor.length > 2048) return null;
      const parts = /^s1\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]{43})$/.exec(cursor);
      if (!parts) return null;
      const signature = Buffer.from(parts[2]!, 'base64url'), expected = mac(owner, parts[1]!);
      if (signature.length !== expected.length || !timingSafeEqual(signature, expected)) return null;
      try {
        const value = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString()) as Positions;
        if (!eventCursorSchema.safeParse(value.user).success || !eventCursorSchema.safeParse(value.market).success || Object.keys(value).length !== 2) return null;
        return value;
      } catch { return null; }
    }
  };
}
