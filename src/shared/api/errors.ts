/** Stable error envelope for /api/v1: `{ error: { code, message, details? } }`. */
export type ApiErrorDetails = Record<string, unknown>;

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly details?: ApiErrorDetails,
    public readonly headers?: Record<string, string>
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function errorResponse(
  code: string,
  message: string,
  status: number,
  details?: ApiErrorDetails,
  headers?: Record<string, string>
): Response {
  const body = { error: details ? { code, message, details } : { code, message } };
  return Response.json(body, { status, headers });
}

export function jsonResponse(data: unknown, status = 200, headers?: Record<string, string>) {
  return Response.json(data, { status, headers });
}

/** Turn any thrown value into an envelope; unknown errors become a 500. */
export function toErrorResponse(err: unknown): Response {
  if (err instanceof ApiError) {
    return errorResponse(err.code, err.message, err.status, err.details, err.headers);
  }
  console.error('[api] unhandled error', err);
  return errorResponse('internal', 'Internal error', 500);
}
