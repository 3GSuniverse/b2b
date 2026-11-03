import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

/** An error with a stable code the dashboard can show nicely. */
export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function parseBody<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data ?? {});
  if (!r.success) {
    const fields: Record<string, string> = {};
    for (const issue of r.error.issues) fields[issue.path.join('.') || '_'] ??= issue.message;
    throw new AppError(400, 'validation_failed', 'Some fields need attention', { fields });
  }
  return r.data;
}

/** Every error leaves the API as { error, message, details? } — never a stack trace. */
export function registerErrorHandler(app: FastifyInstance) {
  app.setErrorHandler((err: Error & { statusCode?: number; code?: string; validation?: unknown }, req, reply) => {
    if (err instanceof AppError) {
      return reply.code(err.statusCode).send({ error: err.code, message: err.message, details: err.details });
    }
    const status = err.statusCode && err.statusCode >= 400 && err.statusCode < 600 ? err.statusCode : 500;
    if (status >= 500) req.log.error(err);
    return reply.code(status).send({
      error: status === 429 ? 'rate_limited' : status >= 500 ? 'internal_error' : (err.code ?? 'bad_request').toLowerCase(),
      message: status >= 500 ? 'Something went wrong on our side. Please try again.' : err.message,
    });
  });
}
