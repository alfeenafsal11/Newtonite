import { FastifyError, FastifyReply, FastifyRequest } from 'fastify';

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details?: unknown;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export function errorHandler(
  error: FastifyError | AppError | Error,
  request: FastifyRequest,
  reply: FastifyReply
) {
  const requestId = (request.headers['x-request-id'] as string) || request.id || 'unknown';

  if (error instanceof AppError) {
    return reply.status(error.statusCode).send({
      error: {
        code: error.code,
        message: error.message,
        details: error.details,
        request_id: requestId,
      },
    });
  }

  // Handle Zod / Schema validation errors
  if (error.name === 'ZodError' || (error as any).issues) {
    return reply.status(400).send({
      error: {
        code: 'validation_error',
        message: 'Invalid request data',
        details: (error as any).issues || (error as any).errors,
        request_id: requestId,
      },
    });
  }

  // Handle Fastify schema validation errors
  if ('validation' in error && error.validation) {
    return reply.status(400).send({
      error: {
        code: 'validation_error',
        message: 'Invalid request data',
        details: error.validation,
        request_id: requestId,
      },
    });
  }

  // Handle Rate Limiter errors
  if ('statusCode' in error && error.statusCode === 429) {
    return reply.status(429).send({
      error: {
        code: 'rate_limited',
        message: 'Too many requests, please try again later',
        request_id: requestId,
      },
    });
  }

  // Generic or unexpected internal errors
  const status = typeof (error as any).statusCode === 'number' ? (error as any).statusCode : 500;
  request.log.error({ err: error, requestId }, 'Unhandled application error');

  return reply.status(status >= 400 && status < 600 ? status : 500).send({
    error: {
      code: 'internal',
      message: 'An unexpected internal error occurred',
      request_id: requestId,
    },
  });
}
