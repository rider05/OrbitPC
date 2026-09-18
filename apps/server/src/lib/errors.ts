import type { ErrorCode } from '@orbit/protocol';

/** Stable REST error shape: { error: { code, message, requestId } }. */
export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;

  constructor(code: ErrorCode, status: number, message: string) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export const Errors = {
  notFound: (message = 'Not found.') => new ApiError('NOT_FOUND', 404, message),
  invalidArgument: (message = 'Invalid request.') => new ApiError('INVALID_ARGUMENT', 400, message),
  authRequired: (message = 'Authentication required.') =>
    new ApiError('AUTH_REQUIRED', 401, message),
  internal: (message = 'Internal error.') => new ApiError('INTERNAL', 500, message),
} as const;
