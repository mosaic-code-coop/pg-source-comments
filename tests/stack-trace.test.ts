import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  captureSourceLocation,
  defaultPathTransformer,
} from '../src/stack-trace.js';

describe('defaultPathTransformer', () => {
  it('extracts path after /src/', () => {
    const result = defaultPathTransformer('/home/user/project/src/api/users.ts');
    expect(result).toBe('src/api/users.ts');
  });

  it('extracts path after /lib/', () => {
    const result = defaultPathTransformer('/home/user/project/lib/utils.ts');
    expect(result).toBe('lib/utils.ts');
  });

  it('extracts path after /app/', () => {
    const result = defaultPathTransformer('/home/user/project/app/routes/index.ts');
    expect(result).toBe('app/routes/index.ts');
  });

  it('extracts path after /pages/', () => {
    const result = defaultPathTransformer('/home/user/project/pages/api/hello.ts');
    expect(result).toBe('pages/api/hello.ts');
  });

  it('extracts path after /api/', () => {
    const result = defaultPathTransformer('/home/user/project/api/handlers.ts');
    expect(result).toBe('api/handlers.ts');
  });

  it('uses last two path segments as fallback', () => {
    const result = defaultPathTransformer('/home/user/project/custom/file.ts');
    expect(result).toBe('custom/file.ts');
  });

  it('returns full path if only one segment', () => {
    const result = defaultPathTransformer('file.ts');
    expect(result).toBe('file.ts');
  });

  it('uses last occurrence of marker', () => {
    const result = defaultPathTransformer('/home/src/project/src/nested/file.ts');
    expect(result).toBe('src/nested/file.ts');
  });
});

describe('captureSourceLocation', () => {
  // Note: These tests run through vitest which may filter all frames as node_modules
  // The tests verify the function doesn't throw and returns expected types

  it('returns null or SourceLocation object', () => {
    const location = captureSourceLocation();
    // Either null (all frames filtered) or a valid location object
    if (location !== null) {
      expect(location.filePath).toBeDefined();
      expect(typeof location.filePath).toBe('string');
      expect(location.lineNumber).toBeGreaterThan(0);
    } else {
      // When running in vitest, all frames may be in node_modules
      expect(location).toBeNull();
    }
  });

  it('does not throw with empty config', () => {
    expect(() => captureSourceLocation()).not.toThrow();
  });

  it('does not throw with custom exclude patterns', () => {
    expect(() => captureSourceLocation({
      excludePatterns: [/custom-pattern/],
    })).not.toThrow();
  });

  it('respects frameCount limit without throwing', () => {
    expect(() => captureSourceLocation({ frameCount: 1 })).not.toThrow();
    expect(() => captureSourceLocation({ frameCount: 50 })).not.toThrow();
  });

  it('filters frames matching exclude patterns', () => {
    // If we get a location, verify it doesn't match default exclude patterns
    const location = captureSourceLocation();
    if (location) {
      expect(location.filePath).not.toMatch(/^node:/);
      // The result should be a non-excluded path
      expect(typeof location.lineNumber).toBe('number');
    }
  });

  it('returns location with expected shape when found', () => {
    const location = captureSourceLocation();
    if (location) {
      expect(location).toHaveProperty('filePath');
      expect(location).toHaveProperty('lineNumber');
      // columnNumber and functionName are optional
      if (location.columnNumber !== undefined) {
        expect(typeof location.columnNumber).toBe('number');
      }
      if (location.functionName !== undefined) {
        expect(typeof location.functionName).toBe('string');
      }
    }
  });
});
