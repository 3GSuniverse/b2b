import type { MultipartFile } from '@fastify/multipart';
import { and, desc, eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { importJobs, lists } from '../../db/schema.js';
import { db } from '../../lib/db.js';
import { AppError } from '../../lib/http.js';
import { enqueueImport } from '../../queues/index.js';
import { requireAuth, tenantOf } from '../auth/guard.js';
import { createList } from '../contacts/service.js';
import { autoMap, detectType, readCsv, type ColumnTarget } from './mapping.js';
import { processImport } from './process.js';

/** Files up to this many rows are imported while the user waits; bigger ones go to the worker. */
export const INLINE_IMPORT_ROWS = 2000;

const TARGET = z.union([
  z.enum(['email', 'phone', 'firstName', 'lastName', 'fullName', 'skip']),
  z.string().regex(/^attr:[a-z][a-z0-9_]{0,39}$/),
]);

const optionsSchema = z.object({
  consentConfirmed: z.literal('true', { message: 'Confirm that these people agreed to receive emails from you' }),
  listId: z.string().optional(),
  newListName: z.string().trim().min(1).max(80).optional(),
  updateExisting: z.enum(['true', 'false']).default('true'),
  mapping: z
    .string()
    .optional()
    .transform((v, ctx) => {
      if (!v) return undefined;
      try {
        return z.record(z.string(), TARGET).parse(JSON.parse(v)) as Record<string, ColumnTarget>;
      } catch {
        ctx.addIssue({ code: 'custom', message: 'Column mapping is not valid' });
        return z.NEVER;
      }
    }),
});

async function readUpload(req: FastifyRequest) {
  if (!req.isMultipart()) throw new AppError(415, 'multipart_required', 'Upload the file as multipart/form-data');
  let file: MultipartFile | undefined;
  let csv = '';
  const fields: Record<string, string> = {};
  for await (const part of req.parts()) {
    if (part.type === 'file') {
      if (file) throw new AppError(400, 'one_file_only', 'Upload one file at a time');
      file = part;
      const name = part.filename.toLowerCase();
      if (!name.endsWith('.csv') && !name.endsWith('.txt') && !part.mimetype.includes('csv')) {
        throw new AppError(400, 'csv_only', 'Upload a .csv file. In Excel: File → Save As → CSV (UTF-8).');
      }
      csv = (await part.toBuffer()).toString('utf8');
      if (part.file.truncated) throw new AppError(413, 'file_too_large', 'The file is too large (limit 10 MB)');
    } else {
      fields[part.fieldname] = String(part.value);
    }
  }
  if (!file) throw new AppError(400, 'file_required', 'Choose a CSV file to upload');
  return { fileName: file.filename.slice(0, 200), csv, fields };
}

export async function importRoutes(app: FastifyInstance) {
  // Step 1 of the import screen: show columns, the guessed mapping and a few sample rows
  app.post('/api/imports/preview', { preHandler: requireAuth }, async (req) => {
    const { csv } = await readUpload(req);
    const { headers, rows } = readCsv(csv);
    const mapping = autoMap(headers);
    return {
      headers,
      mapping,
      detectedTypes: Object.fromEntries(
        headers.map((h, i) => [h, mapping[h]?.startsWith('attr:') ? detectType(h, rows.map((r) => r[i] ?? '')) : null]),
      ),
      sample: rows.slice(0, 5),
      totalRows: rows.length,
      hasEmailColumn: Object.values(mapping).includes('email'),
    };
  });

  // Step 2: import
  app.post('/api/imports', { preHandler: requireAuth }, async (req, reply) => {
    const tenantId = tenantOf(req);
    const { fileName, csv, fields } = await readUpload(req);
    const parsed = optionsSchema.safeParse(fields);
    if (!parsed.success) {
      const f: Record<string, string> = {};
      for (const i of parsed.error.issues) f[i.path.join('.') || '_'] ??= i.message;
      throw new AppError(400, 'validation_failed', 'Some fields need attention', { fields: f });
    }
    const opts = parsed.data;
    const { rows } = readCsv(csv); // fail fast on unreadable files

    let listId = opts.listId;
    if (listId) {
      const l = await db.query.lists.findFirst({ where: and(eq(lists.id, listId), eq(lists.tenantId, tenantId), eq(lists.ownerId, req.auth!.userId)) });
      if (!l) throw new AppError(404, 'list_not_found', 'List not found');
    } else if (opts.newListName) {
      listId = (await createList(tenantId, opts.newListName, undefined, req.auth!.userId)).id;
    }

    const [job] = await db
      .insert(importJobs)
      .values({
        tenantId,
        fileName,
        listId,
        createdById: req.auth!.userId,
        sourceCsv: csv,
        options: { updateExisting: opts.updateExisting === 'true', mapping: opts.mapping },
      })
      .returning();

    if (rows.length <= INLINE_IMPORT_ROWS) {
      const result = await processImport(job!.id);
      return reply.code(201).send({ import: { id: job!.id, status: 'COMPLETED', fileName, listId, ...result } });
    }
    await enqueueImport(job!.id);
    return reply.code(202).send({ import: { id: job!.id, status: 'PENDING', fileName, listId, totalRows: rows.length } });
  });

  app.get('/api/imports', { preHandler: requireAuth }, async (req) => {
    const rows = await db
      .select({
        id: importJobs.id,
        fileName: importJobs.fileName,
        listId: importJobs.listId,
        status: importJobs.status,
        totalRows: importJobs.totalRows,
        imported: importJobs.imported,
        updated: importJobs.updated,
        skipped: importJobs.skipped,
        createdAt: importJobs.createdAt,
        completedAt: importJobs.completedAt,
      })
      .from(importJobs)
      .where(eq(importJobs.tenantId, tenantOf(req)))
      .orderBy(desc(importJobs.createdAt))
      .limit(20);
    return { imports: rows };
  });

  app.get<{ Params: { id: string } }>('/api/imports/:id', { preHandler: requireAuth }, async (req) => {
    const job = await db.query.importJobs.findFirst({
      where: and(eq(importJobs.id, req.params.id), eq(importJobs.tenantId, tenantOf(req))),
      columns: { sourceCsv: false },
    });
    if (!job) throw new AppError(404, 'import_not_found', 'Import not found');
    return { import: job };
  });
}
