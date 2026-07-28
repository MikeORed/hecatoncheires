import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { successResponse, errorResponse } from './envelope.js';

describe('Feature: phase-1-api-package-setup', () => {
  describe('Property 3: Success envelope structure', () => {
    it('for any status code and JSON-serializable data, successResponse produces correct envelope', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 100, max: 599 }),
          fc.jsonValue(),
          (statusCode, data) => {
            const result = successResponse(statusCode, data);
            expect(result.statusCode).toBe(statusCode);
            expect(result.headers).toEqual({ 'Content-Type': 'application/json' });

            const parsed = JSON.parse(result.body);
            expect(parsed.success).toBe(true);
            expect(parsed.data).toEqual(data);
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  describe('Property 4: Error envelope structure', () => {
    it('for any status code, code, message, and optional details, errorResponse produces correct envelope', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 100, max: 599 }),
          fc.string({ minLength: 1, maxLength: 50 }),
          fc.string({ minLength: 1, maxLength: 200 }),
          fc.option(fc.jsonValue(), { nil: undefined }),
          (statusCode, code, message, details) => {
            const result = errorResponse(statusCode, code, message, details);
            expect(result.statusCode).toBe(statusCode);
            expect(result.headers).toEqual({ 'Content-Type': 'application/json' });

            const parsed = JSON.parse(result.body);
            expect(parsed.success).toBe(false);
            expect(parsed.error.code).toBe(code);
            expect(parsed.error.message).toBe(message);

            if (details !== undefined) {
              expect(parsed.error.details).toEqual(details);
            } else {
              expect(parsed.error).not.toHaveProperty('details');
            }
          },
        ),
        { numRuns: 100 },
      );
    });
  });
});
