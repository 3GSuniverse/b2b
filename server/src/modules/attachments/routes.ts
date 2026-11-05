import type { FastifyInstance } from 'fastify';
import { AppError } from '../../lib/http.js';
import { requireAuth, tenantOf } from '../auth/guard.js';
import { LIMITS, readAttachment, saveAttachment } from './service.js';

// Shown in the page itself; anything else (HTML, SVG, PDFs with scripts) only downloads
const INLINE = /^(image\/(jpeg|png|webp|gif)|video\/(mp4|quicktime|3gpp)|audio\/[a-z0-9.+-]+)$/;

export async function attachmentRoutes(app: FastifyInstance) {
  app.post('/api/attachments', { preHandler: requireAuth, config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req, reply) => {
    if (!req.isMultipart()) throw new AppError(415, 'multipart_required', 'Upload the file as multipart/form-data');
    const part = await req.file({ limits: { fileSize: LIMITS.fileBytes, files: 1 } });
    if (!part) throw new AppError(400, 'file_required', 'Choose a file to attach');
    const data = await part.toBuffer().catch((e: Error & { code?: string }) => {
      if (e.code === 'FST_REQ_FILE_TOO_LARGE') throw new AppError(413, 'file_too_large', 'Files can be up to 16 MB each');
      throw e;
    });
    if (part.file.truncated) throw new AppError(413, 'file_too_large', 'Files can be up to 16 MB each');
    const attachment = await saveAttachment(tenantOf(req), req.auth!.userId, { name: part.filename, type: part.mimetype, data });
    return reply.code(201).send({ attachment });
  });

  app.get<{ Params: { id: string }; Querystring: { download?: string } }>('/api/attachments/:id', { preHandler: requireAuth }, async (req, reply) => {
    const a = await readAttachment(tenantOf(req), req.params.id);
    const inline = INLINE.test(a.type) && req.query.download === undefined;
    const ascii = a.name.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '');
    return reply
      .header('content-type', inline ? a.type : 'application/octet-stream')
      .header('content-disposition', `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(a.name)}`)
      .header('content-security-policy', "sandbox; default-src 'none'; img-src 'self'; media-src 'self'")
      .header('cache-control', 'private, max-age=86400')
      .send(a.data);
  });
}
