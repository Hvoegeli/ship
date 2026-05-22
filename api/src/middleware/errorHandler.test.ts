import { describe, it, expect, vi } from 'vitest';
import { Request, Response, NextFunction } from 'express';
import {
  validateUuidParam,
  enforceJsonContentType,
  apiNotFoundHandler,
  jsonErrorHandler,
} from './errorHandler.js';
import { getUserId, getWorkspaceId } from './auth.js';

// Cat-5: meaningful unit tests for the Cat-6 error-handling layer and the Cat-1
// validated auth accessors — new, security-relevant code paths that had zero
// coverage. Each test names the regression it guards.

function mockRes() {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    status: vi.fn(function (this: any, c: number) { res.statusCode = c; return this; }),
    json: vi.fn(function (this: any, b: unknown) { res.body = b; return this; }),
  } as unknown as Response & { statusCode: number; body: any };
  return res;
}

const VALID_UUID = '11111111-1111-4111-8111-111111111111';

describe('errorHandler middleware (Cat-6)', () => {
  describe('validateUuidParam — guards bad-uuid → 500 + PG error (H8)', () => {
    it('rejects a non-UUID param with 400 and does not call next', () => {
      const res = mockRes();
      const next = vi.fn();
      validateUuidParam('id')({} as Request, res, next as NextFunction, 'not-a-uuid');
      expect(res.statusCode).toBe(400);
      expect((res as any).body.error.code).toBe('VALIDATION_ERROR');
      expect(next).not.toHaveBeenCalled();
    });

    it('passes a valid UUID through to next()', () => {
      const res = mockRes();
      const next = vi.fn();
      validateUuidParam('id')({} as Request, res, next as NextFunction, VALID_UUID);
      expect(next).toHaveBeenCalledOnce();
      expect(res.statusCode).toBe(0);
    });
  });

  describe('enforceJsonContentType — guards silent junk-doc creation (M3)', () => {
    function call(method: string, headers: Record<string, string>) {
      const res = mockRes();
      const next = vi.fn();
      enforceJsonContentType(
        { method, headers, is: (t: string[]) => Object.values(headers).some(v => t.some(x => v.includes(x))) ? 'match' : false } as unknown as Request,
        res,
        next as NextFunction
      );
      return { res, next };
    }

    it('rejects a text/plain POST body with 415', () => {
      const { res, next } = call('POST', { 'content-length': '20', 'content-type': 'text/plain' });
      expect(res.statusCode).toBe(415);
      expect(next).not.toHaveBeenCalled();
    });

    it('allows an application/json POST body', () => {
      const { res, next } = call('POST', { 'content-length': '20', 'content-type': 'application/json' });
      expect(next).toHaveBeenCalledOnce();
    });

    it('skips GET requests (no body to validate)', () => {
      const { next } = call('GET', { 'content-type': 'text/plain' });
      expect(next).toHaveBeenCalledOnce();
    });

    it('skips a POST with no body (content-length 0)', () => {
      const { next } = call('POST', { 'content-length': '0', 'content-type': 'text/plain' });
      expect(next).toHaveBeenCalledOnce();
    });
  });

  describe('jsonErrorHandler — guards HTML/stack-trace leakage (H8)', () => {
    function run(err: unknown) {
      const res = mockRes();
      const next = vi.fn();
      jsonErrorHandler(err, {} as Request, res, next as NextFunction);
      return res as any;
    }

    it('maps malformed JSON (entity.parse.failed) → 400 JSON', () => {
      const res = run({ type: 'entity.parse.failed' });
      expect(res.statusCode).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('maps oversized body (entity.too.large) → 413', () => {
      const res = run({ type: 'entity.too.large' });
      expect(res.statusCode).toBe(413);
    });

    it('maps a CSRF rejection (statusCode 403) → 403 JSON', () => {
      const res = run({ statusCode: 403 });
      expect(res.statusCode).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('maps a Postgres invalid-uuid (22P02) → 400 JSON', () => {
      const res = run({ code: '22P02' });
      expect(res.statusCode).toBe(400);
    });

    it('falls back to a generic 500 without leaking the error message', () => {
      const res = run(new Error('sensitive internal detail with stack'));
      expect(res.statusCode).toBe(500);
      expect(res.body.error.message).toBe('Internal server error');
      expect(JSON.stringify(res.body)).not.toContain('sensitive internal detail');
    });
  });

  describe('apiNotFoundHandler', () => {
    it('returns a JSON 404 (not an HTML page)', () => {
      const res = mockRes();
      apiNotFoundHandler({ method: 'GET', path: '/api/nope' } as Request, res);
      expect(res.statusCode).toBe(404);
      expect((res as any).body.error.code).toBe('NOT_FOUND');
    });
  });
});

describe('auth accessors (Cat-1) — validated narrowing of req.userId!/workspaceId!', () => {
  it('getUserId returns the id on an authenticated request', () => {
    expect(getUserId({ userId: 'user-123' } as Request)).toBe('user-123');
  });

  it('getUserId THROWS on a request without authentication (vs silently passing undefined)', () => {
    expect(() => getUserId({} as Request)).toThrow(/authentication/i);
  });

  it('getWorkspaceId returns the id on an authenticated request', () => {
    expect(getWorkspaceId({ workspaceId: 'ws-123' } as Request)).toBe('ws-123');
  });

  it('getWorkspaceId THROWS on a request without authentication', () => {
    expect(() => getWorkspaceId({} as Request)).toThrow(/authentication/i);
  });
});
