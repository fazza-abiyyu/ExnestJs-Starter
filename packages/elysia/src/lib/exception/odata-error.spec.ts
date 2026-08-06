import { describe, expect, test } from 'bun:test';
import { ODataError } from './index.js';

describe('ODataError', () => {
  test('should create error with code, message, and status', () => {
    const error = new ODataError('TEST_ERROR', 'Something went wrong', 400);

    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe('TEST_ERROR');
    expect(error.message).toBe('Something went wrong');
    expect(error.status).toBe(400);
    expect(error.lang).toBeUndefined();
    expect(error.name).toBe('ODataError');
  });

  test('should support lang parameter', () => {
    const error = new ODataError('NOT_FOUND', 'Not found', 404, 'id');

    expect(error.lang).toBe('id');
  });

  test('should be throwable and catchable', () => {
    const fn = () => {
      throw new ODataError('ERROR', 'Error', 500);
    };

    expect(fn).toThrow(ODataError);
    expect(fn).toThrow('Error');
  });
});
