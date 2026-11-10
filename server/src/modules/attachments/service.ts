import { and, eq, inArray, lt, sql } from 'drizzle-orm';
import { z } from 'zod';
import { attachments, type AttachmentRef } from '../../db/schema.js';
import { db } from '../../lib/db.js';
import { AppError } from '../../lib/http.js';

/**
 * Files sent with emails and WhatsApp messages.
 *
 * Limits follow what actually arrives: WhatsApp takes media up to 16 MB, and most inboxes refuse
 * an email much over 20 MB once attachments are encoded, so an email carries 15 MB in all.
 */
export const LIMITS = {
  fileBytes: 16 * 1024 * 1024,
  emailTotalBytes: 15 * 1024 * 1024,
  files: 10,
} as const;

// Gmail and most mail servers reject these outright, and they are how malware travels
const BLOCKED = new Set(
  'ade adp apk appx appxbundle bat cab chm cmd com cpl diagcab dll dmg ex ex_ exe hta img ins iso isp jar jnlp js jse lib lnk mde mjs msc msi msix msp mst nsh pif ps1 scr sct shb sys vb vbe vbs vhd vxd wsc wsf wsh xll'.split(' '),
);

const BY_EXTENSION: Record<string, string> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  heic: 'image/heic',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  '3gp': 'video/3gpp',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  ogg: 'audio/ogg',
  opus: 'audio/ogg',
  wav: 'audio/wav',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  csv: 'text/csv',
  txt: 'text/plain',
  zip: 'application/zip',
};

const extension = (name: string) => (name.includes('.') ? name.split('.').pop()!.toLowerCase() : '');

/** A file name that is safe in a mail header and on a phone: no paths, no control characters. */
export function cleanName(name: string) {
  const base = name.split(/[\\/]/).pop() ?? '';
  const clean = base.replace(/[\u0000-\u001f\u007f"<>:|?*]+/g, ' ').replace(/\s+/g, ' ').trim().slice(-150);
  return clean || 'file';
}

/** The browser's type when it gives a useful one, else one from the extension. */
export function typeFor(name: string, given: string | undefined) {
  const g = (given ?? '').toLowerCase().split(';')[0]!.trim();
  if (g && g !== 'application/octet-stream') return g;
  return BY_EXTENSION[extension(name)] ?? 'application/octet-stream';
}

/** How WhatsApp shows it: a photo, a video, a voice/audio clip, or a document with its name. */
export function whatsappKind(type: string): 'image' | 'video' | 'audio' | 'document' {
  if (/^image\/(jpeg|png|webp)$/.test(type)) return 'image';
  if (/^video\/(mp4|3gpp)$/.test(type)) return 'video';
  if (type.startsWith('audio/')) return 'audio';
  return 'document';
}

export async function saveAttachment(tenantId: string, userId: string | null, file: { name: string; type?: string; data: Buffer }): Promise<AttachmentRef> {
  const name = cleanName(file.name);
  if (BLOCKED.has(extension(name))) {
    throw new AppError(400, 'file_type_blocked', `.${extension(name)} files can’t be sent: email providers block them. Put it in a zip or share a link instead.`);
  }
  if (file.data.length === 0) throw new AppError(400, 'file_empty', 'That file is empty');
  if (file.data.length > LIMITS.fileBytes) throw new AppError(413, 'file_too_large', 'Files can be up to 16 MB each');
  const type = typeFor(name, file.type);
  const [row] = await db
    .insert(attachments)
    .values({ tenantId, name, type, size: file.data.length, data: file.data, createdById: userId })
    .returning({ id: attachments.id, name: attachments.name, type: attachments.type, size: attachments.size });
  return row!;
}

/** Up to 10 attachment ids, as a request sends them. */
export const attachmentIds = z.array(z.string().min(1).max(40)).max(LIMITS.files, `Attach up to ${LIMITS.files} files`);

/** This company's attachments, in the order given. Unknown ids are refused, so nobody can send another company's files. */
export async function resolveRefs(tenantId: string, ids: string[] | undefined | null): Promise<AttachmentRef[]> {
  const unique = [...new Set(ids ?? [])];
  if (!unique.length) return [];
  const rows = await db
    .select({ id: attachments.id, name: attachments.name, type: attachments.type, size: attachments.size })
    .from(attachments)
    .where(and(eq(attachments.tenantId, tenantId), inArray(attachments.id, unique)));
  const byId = new Map(rows.map((r) => [r.id, r]));
  const missing = unique.filter((id) => !byId.has(id));
  if (missing.length) throw new AppError(400, 'attachment_not_found', 'One of the attached files couldn’t be found. Attach it again.');
  return unique.map((id) => byId.get(id)!);
}

export const totalSize = (refs: AttachmentRef[]) => refs.reduce((a, r) => a + r.size, 0);

/** Every attachment, once, in order: a template's files first, then the message's own. */
export function mergeRefs(...groups: (AttachmentRef[] | null | undefined)[]) {
  const seen = new Set<string>();
  const out: AttachmentRef[] = [];
  for (const r of groups.flat()) {
    if (r && !seen.has(r.id)) {
      seen.add(r.id);
      out.push(r);
    }
  }
  return out;
}

export type AttachmentFile = { name: string; type: string; data: Buffer };

// A broadcast sends the same brochure to every customer: keep recent files in memory instead of
// reading them from the database once per message.
const CACHE_BYTES = 64 * 1024 * 1024;
const cache = new Map<string, AttachmentFile>();
let cached = 0;

/** The bytes of these attachments, ready to send. */
export async function loadFiles(tenantId: string, refs: AttachmentRef[]): Promise<AttachmentFile[]> {
  if (!refs.length) return [];
  const want = refs.filter((r) => !cache.has(`${tenantId}:${r.id}`)).map((r) => r.id);
  if (want.length) {
    const rows = await db
      .select({ id: attachments.id, name: attachments.name, type: attachments.type, data: attachments.data })
      .from(attachments)
      .where(and(eq(attachments.tenantId, tenantId), inArray(attachments.id, want)));
    for (const r of rows) {
      const key = `${tenantId}:${r.id}`;
      cache.set(key, { name: r.name, type: r.type, data: r.data });
      cached += r.data.length;
    }
    for (const [k, v] of cache) {
      if (cached <= CACHE_BYTES) break;
      cache.delete(k);
      cached -= v.data.length;
    }
  }
  return refs.map((r) => {
    const f = cache.get(`${tenantId}:${r.id}`);
    if (!f) throw new AppError(410, 'attachment_gone', `The attachment “${r.name}” no longer exists`);
    return f;
  });
}

export async function readAttachment(tenantId: string, id: string) {
  const row = await db.query.attachments.findFirst({ where: and(eq(attachments.id, id), eq(attachments.tenantId, tenantId)) });
  if (!row) throw new AppError(404, 'attachment_not_found', 'File not found');
  return row;
}

/**
 * Uploads nobody ended up using (attached, then removed before saving) are deleted after a week.
 * Anything a broadcast, template, automation, message or customer care request points to is kept.
 */
export async function removeUnusedAttachments(now = new Date()) {
  const before = new Date(now.getTime() - 7 * 86_400_000);
  const used = (table: string) => sql`exists (select 1 from ${sql.identifier(table)} x where x.attachments @> jsonb_build_array(jsonb_build_object('id', ${attachments.id})))`;
  const gone = await db
    .delete(attachments)
    .where(and(lt(attachments.createdAt, before), sql`not ${used('campaigns')}`, sql`not ${used('templates')}`, sql`not ${used('automations')}`, sql`not ${used('messages')}`, sql`not ${used('support_messages')}`))
    .returning({ id: attachments.id });
  return gone.length;
}
