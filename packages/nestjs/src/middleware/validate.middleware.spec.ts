import { z } from 'zod';
import { validate } from '../middleware/validate.middleware.js';
import type { Request, Response, NextFunction } from 'express';

function mockReqRes(body?: unknown, query?: unknown, params?: unknown) {
  const req = { body, query, params } as Request;
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  } as unknown as Response;
  const next = jest.fn() as NextFunction;
  return { req, res, next };
}

describe('validate middleware', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should pass valid body through', () => {
    const schema = { body: z.object({ name: z.string() }) };
    const { req, res, next } = mockReqRes({ name: 'test' });

    validate(schema)(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('should reject invalid body', () => {
    const schema = { body: z.object({ name: z.string() }) };
    const { req, res, next } = mockReqRes({ name: 123 });

    validate(schema)(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);

    /* eslint-disable @typescript-eslint/no-unsafe-assignment */
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({ code: 'VALIDATION_ERROR' }),
      }),
    );
    /* eslint-enable @typescript-eslint/no-unsafe-assignment */
  });

  it('should pass valid query through', () => {
    const schema = {
      query: z.object({ page: z.coerce.number() }),
    };
    const { req, res, next } = mockReqRes(undefined, { page: '2' });

    validate(schema)(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  it('should pass when no schema provided', () => {
    const { req, res, next } = mockReqRes({ name: 'test' });

    validate({})(req, res, next);

    expect(next).toHaveBeenCalled();
  });
});
