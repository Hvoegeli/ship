import { Request, Response, NextFunction } from 'express';
import { ERROR_CODES, HTTP_STATUS } from '@ship/shared';

/**
 * Cat-6: centralized error handling so the API NEVER falls through to Express's
 * default HTML stack-trace page. Every error path returns the same JSON envelope
 * `{ success: false, error: { code, message } }` used by the route handlers, with
 * no stack-trace leakage to the client.
 */

function envelope(code: string, message: string) {
  return { success: false, error: { code, message } };
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `router.param` handler factory: rejects a path param that is not a valid UUID
 * with a clean 400 BEFORE it reaches a DB query. Without this, `GET
 * /api/documents/not-a-uuid` reaches Postgres, which raises `22P02 invalid input
 * syntax for type uuid`, surfacing as a 500 + a server-log ERROR (finding H8).
 */
export function validateUuidParam(paramName: string) {
  return (req: Request, res: Response, next: NextFunction, value: string) => {
    if (!UUID_RE.test(value)) {
      res
        .status(HTTP_STATUS.BAD_REQUEST)
        .json(envelope(ERROR_CODES.VALIDATION_ERROR, `Invalid ${paramName}: not a valid identifier`));
      return;
    }
    next();
  };
}

/**
 * Reject mutating requests whose body is sent with an unsupported Content-Type.
 * Previously a `text/plain` body slipped past `express.json()` (which only parses
 * `application/json`), leaving `req.body` empty, so e.g. `POST /api/documents`
 * silently created an "Untitled" junk document and returned 201 (finding M3 — a
 * silent-failure / data-confusion bug). JSON, url-encoded forms (public feedback)
 * and multipart (file uploads) are allowed; anything else with a body is 415.
 */
export function enforceJsonContentType(req: Request, res: Response, next: NextFunction): void {
  if (req.method !== 'POST' && req.method !== 'PUT' && req.method !== 'PATCH') {
    next();
    return;
  }
  const contentLength = req.headers['content-length'];
  const hasBody = (contentLength !== undefined && contentLength !== '0') || req.headers['transfer-encoding'] !== undefined;
  if (!hasBody) {
    next();
    return;
  }
  if (req.is(['application/json', 'application/x-www-form-urlencoded', 'multipart/form-data'])) {
    next();
    return;
  }
  res
    .status(HTTP_STATUS.UNSUPPORTED_MEDIA_TYPE)
    .json(envelope(ERROR_CODES.UNSUPPORTED_MEDIA_TYPE, 'Content-Type must be application/json'));
}

/** Final 404 for unmatched /api routes — JSON, not HTML. */
export function apiNotFoundHandler(req: Request, res: Response): void {
  res
    .status(HTTP_STATUS.NOT_FOUND)
    .json(envelope(ERROR_CODES.NOT_FOUND, `Route not found: ${req.method} ${req.path}`));
}

/**
 * Centralized JSON error handler (must be registered LAST, after all routes).
 * Maps the common failure classes that previously leaked HTML/stack traces:
 *  - malformed JSON body (express.json) -> 400
 *  - oversized body                     -> 413
 *  - CSRF rejection (csrf-sync)         -> 403
 *  - Postgres invalid-text/uuid (22P02) -> 400  (safety net for routes that
 *    propagate instead of swallowing; the hot routes also validate via router.param)
 *  - everything else                    -> 500 with a generic message (no leak)
 */
export function jsonErrorHandler(
  err: any,
  _req: Request,
  res: Response,
  next: NextFunction
): void {
  if (res.headersSent) {
    next(err);
    return;
  }

  // Body-parser malformed JSON
  if (err?.type === 'entity.parse.failed' || (err instanceof SyntaxError && 'body' in (err as any))) {
    res.status(HTTP_STATUS.BAD_REQUEST).json(envelope(ERROR_CODES.VALIDATION_ERROR, 'Malformed JSON in request body'));
    return;
  }

  // Body-parser payload too large
  if (err?.type === 'entity.too.large') {
    res.status(HTTP_STATUS.PAYLOAD_TOO_LARGE).json(envelope(ERROR_CODES.PAYLOAD_TOO_LARGE, 'Request body too large'));
    return;
  }

  // CSRF rejection (csrf-sync throws a 403 error)
  if (err?.code === 'EBADCSRFTOKEN' || err?.statusCode === HTTP_STATUS.FORBIDDEN) {
    res.status(HTTP_STATUS.FORBIDDEN).json(envelope(ERROR_CODES.FORBIDDEN, 'Invalid or missing CSRF token'));
    return;
  }

  // Postgres invalid text representation (e.g. bad UUID that reached the driver)
  if (err?.code === '22P02') {
    res.status(HTTP_STATUS.BAD_REQUEST).json(envelope(ERROR_CODES.VALIDATION_ERROR, 'Invalid identifier format'));
    return;
  }

  // Fallback — log server-side, return a generic envelope (never the stack)
  console.error('Unhandled error:', err);
  const status = typeof err?.status === 'number' ? err.status
    : typeof err?.statusCode === 'number' ? err.statusCode
    : HTTP_STATUS.INTERNAL_SERVER_ERROR;
  const message = status === HTTP_STATUS.INTERNAL_SERVER_ERROR ? 'Internal server error' : (err?.message || 'Request failed');
  res.status(status).json(envelope(ERROR_CODES.INTERNAL_ERROR, message));
}
