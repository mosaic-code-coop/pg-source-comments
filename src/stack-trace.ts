import { getCallSites } from 'node:util';
import type { CallSiteInfo, SourceLocation, QueryIdConfig } from './types.js';

type LogFn = (message: string, ...args: unknown[]) => void;

// Default patterns to exclude from stack traces
const DEFAULT_EXCLUDE_PATTERNS: RegExp[] = [
  /node_modules/,
  /@prisma/,
  /prisma-client/,
  /prisma-query-ids/,
  /^node:/,
  /^internal\//,
];

/**
 * Captures the current call stack and returns the first user-code frame.
 * Uses util.getCallSites() with sourceMap support for accurate TS locations.
 */
export function captureSourceLocation(config: QueryIdConfig = {}, logger?: LogFn): SourceLocation | null {
  const {
    excludePatterns = [],
    frameCount = 20,
  } = config;

  // Combine default and custom exclude patterns
  const allExcludePatterns = [
    ...DEFAULT_EXCLUDE_PATTERNS,
    ...excludePatterns.map(p => typeof p === 'string' ? new RegExp(p) : p),
  ];

  let callSites: CallSiteInfo[];

  try {
    callSites = getCallSites({ sourceMap: true }) as CallSiteInfo[];
  } catch (error) {
    // Log error if logger is provided
    if (logger) {
      logger('Failed to capture call sites:', error);
    }
    // Fallback if getCallSites is not available
    return null;
  }

  // Limit to requested frame count
  const limitedSites = callSites.slice(0, frameCount);

  // Find first frame that isn't excluded
  for (const site of limitedSites) {
    const scriptName = site.scriptName;

    // Skip frames without a script name
    if (!scriptName) continue;

    // Check if this frame matches any exclude pattern
    const isExcluded = allExcludePatterns.some(pattern => pattern.test(scriptName));

    if (!isExcluded) {
      return {
        filePath: scriptName,
        lineNumber: site.lineNumber,
        columnNumber: site.columnNumber,
        functionName: site.functionName || undefined,
      };
    }
  }

  return null;
}

/**
 * Default path transformer that creates a clean relative path
 */
export function defaultPathTransformer(fullPath: string): string {
  // Try to find common project markers and make path relative
  const markers = ['/src/', '/lib/', '/app/', '/pages/', '/api/'];

  for (const marker of markers) {
    const index = fullPath.lastIndexOf(marker);
    if (index !== -1) {
      return fullPath.slice(index + 1); // Remove leading slash
    }
  }

  // Fallback: return just the filename with parent directory
  const parts = fullPath.split('/');
  if (parts.length >= 2) {
    return parts.slice(-2).join('/');
  }

  return fullPath;
}
