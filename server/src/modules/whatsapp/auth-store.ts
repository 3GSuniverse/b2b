import { and, eq, inArray } from 'drizzle-orm';
import { BufferJSON, initAuthCreds, proto, type AuthenticationCreds, type AuthenticationState, type SignalDataTypeMap } from 'baileys';
import { whatsappAuth } from '../../db/schema.js';
import { db } from '../../lib/db.js';
import { decryptSecret, encryptSecret } from '../../lib/crypto.js';

const enc = (v: unknown) => encryptSecret(JSON.stringify(v, BufferJSON.replacer));
const dec = <T>(s: string): T => JSON.parse(decryptSecret(s), BufferJSON.reviver) as T;

/**
 * Baileys login state kept in Postgres, encrypted, instead of files on disk —
 * survives redeploys, and a database leak alone can't take over the number.
 */
export async function useDbAuthState(session: { id: string; tenantId: string }): Promise<{ state: AuthenticationState; saveCreds: () => Promise<void> }> {
  const { id: sessionId, tenantId } = session;
  const row = await db.query.whatsappAuth.findFirst({ where: and(eq(whatsappAuth.sessionId, sessionId), eq(whatsappAuth.key, 'creds')) });
  const creds: AuthenticationCreds = row ? dec(row.valueEnc) : initAuthCreds();

  const write = async (key: string, value: unknown) => {
    await db
      .insert(whatsappAuth)
      .values({ tenantId, sessionId, key, valueEnc: enc(value) })
      .onConflictDoUpdate({ target: [whatsappAuth.sessionId, whatsappAuth.key], set: { valueEnc: enc(value) } });
  };

  return {
    state: {
      creds,
      keys: {
        get: async <T extends keyof SignalDataTypeMap>(type: T, ids: string[]) => {
          const out: { [id: string]: SignalDataTypeMap[T] } = {};
          if (!ids.length) return out;
          const rows = await db
            .select()
            .from(whatsappAuth)
            .where(and(eq(whatsappAuth.sessionId, sessionId), inArray(whatsappAuth.key, ids.map((id) => `${type}:${id}`))));
          for (const r of rows) {
            let v = dec<SignalDataTypeMap[T]>(r.valueEnc);
            if (type === 'app-state-sync-key' && v) v = proto.Message.AppStateSyncKeyData.fromObject(v as object) as unknown as SignalDataTypeMap[T];
            out[r.key.slice(type.length + 1)] = v;
          }
          return out;
        },
        set: async (data) => {
          for (const category of Object.keys(data) as (keyof SignalDataTypeMap)[]) {
            for (const [id, value] of Object.entries(data[category] ?? {})) {
              const key = `${category}:${id}`;
              if (value) await write(key, value);
              else await db.delete(whatsappAuth).where(and(eq(whatsappAuth.sessionId, sessionId), eq(whatsappAuth.key, key)));
            }
          }
        },
      },
    },
    saveCreds: () => write('creds', creds),
  };
}

/** Forget the linked device completely (after logout or unlink). */
export async function clearAuthState(sessionId: string) {
  await db.delete(whatsappAuth).where(eq(whatsappAuth.sessionId, sessionId));
}
