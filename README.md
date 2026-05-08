# pg-source-comments

Prepend SQL queries with source file location comments for PostgreSQL. Debug slow database queries by identifying exactly where they originated in your TypeScript code.

## Features

- **Works with any pg-based code** - Wraps `pg` itself, should work with any library that relies on it
- **TypeScript source locations** - Uses source maps to show original `.ts` file paths, not compiled `.js`
- **Prepends comments** - Comments appear at the start of queries, avoiding truncation in database logs

## Requirements

- Node.js 22.9.0+ (for `util.getCallSites()` with source map support)
- pg 8.0.0+
- Run with `--enable-source-maps` for accurate TypeScript locations

## Installation

```bash
npm install pg-source-comments pg
```

## Quick Start

```typescript
// src/db.ts
import { createTrackedPool } from 'pg-source-comments';

// Create a tracked pool
const pool = createTrackedPool({
  host: 'localhost',
  database: 'myapp',
});

// Use it like any pg Pool
const result = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
```

Run your app with source maps enabled:

```bash
node --enable-source-maps dist/index.js
```

Queries in your database logs will now include source locations:

```sql
/* src/api/users.ts:45 */ SELECT * FROM users WHERE id = 1
/* src/services/auth.ts:123 */ UPDATE sessions SET last_active = NOW() WHERE user_id = 2
```

## Using with Prisma

For Prisma ORM, use the driver adapter pattern:

```bash
npm install @prisma/adapter-pg
```

```typescript
// src/prisma.ts
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { createTrackedPool } from 'pg-source-comments';

// Create a tracked pool
const pool = createTrackedPool(process.env.DATABASE_URL!);

// Create Prisma with the tracked pool
const adapter = new PrismaPg(pool);
export const prisma = new PrismaClient({ adapter });
```

Works with both ORM queries (`findMany`, `create`, etc.) and raw queries (`$queryRaw`, `$executeRaw`).

## Using with other libraries

Any library that uses `pg` under the hood works with `pg-source-comments`:

## How It Works

The library wraps the `pg` Pool at the driver level. When any code executes a query, it passes through the underlying `pg` driver, where we:

1. Capture the call stack using `util.getCallSites()`
2. Find the first frame that's user code (not in `node_modules` or library internals)
3. Map the location back to TypeScript source using source maps
4. Prepend a SQL comment with the file path and line number

```
User Code → ORM/Query Builder → pg → PostgreSQL
                                      ↑
                            TrackedPool intercepts & prepends comment
```

## Configuration Options

```typescript
const pool = createTrackedPool(process.env.DATABASE_URL!, {
  // Enable/disable query tracking (default: true)
  enabled: true,

  // Customize how file paths are displayed
  pathTransformer: (fullPath) => {
    // Make paths relative to project root
    return fullPath.replace('/home/user/myapp/', '');
  },

  // Include function name in comment (default: false)
  includeFunctionName: true,

  // Include column number in comment (default: false)
  includeColumn: true,

  // Additional patterns to exclude from stack trace
  excludePatterns: [/__tests__/, /mock-data/],

  // Number of stack frames to capture (default: 20)
  frameCount: 50,

  // Enable debug logging
  debug: true,
  logger: {
    debug: console.debug,
  },
});
```

### Comment Format

Default format: `/* path:line */`

With `includeFunctionName: true`: `/* path:line in functionName */`

With `includeColumn: true`: `/* path:line:column */`

## Transaction Support

Queries within transactions are automatically tracked:

```typescript
const client = await pool.connect();

try {
  await client.query('BEGIN');

  // Each query gets its own source location
  const user = await client.query('SELECT * FROM users WHERE id = $1', [1]);
  await client.query('INSERT INTO posts (title, author_id) VALUES ($1, $2)', ['Hello', 1]);

  await client.query('COMMIT');
} finally {
  client.release();
}
```

Database sees:
```sql
/* src/routes/user.ts:67 */ BEGIN
/* src/routes/user.ts:69 */ SELECT * FROM users WHERE id = 1
/* src/routes/user.ts:70 */ INSERT INTO posts (title, author_id) VALUES ($1, $2)
/* src/routes/user.ts:67 */ COMMIT
```

## TypeScript Setup

For accurate source locations, ensure your `tsconfig.json` has:

```json
{
  "compilerOptions": {
    "sourceMap": true
  }
}
```

And run with source maps enabled:

```bash
# Option 1: Node.js flag
node --enable-source-maps dist/index.js

# Option 2: Using tsx
tsx src/index.ts

# Option 3: Using ts-node
ts-node --esm src/index.ts
```

## API Reference

### `createTrackedPool(poolOrConfig, config)`

Creates a wrapped `pg` Pool that prepends source location comments to all queries.

**Parameters:**

- `poolOrConfig` - An existing `Pool` instance, `PoolConfig` object, or connection string
- `config` - Configuration options (optional)

**Returns:** A `TrackedPool` that behaves like a standard `pg` Pool

### Type Exports

```typescript
import type {
  SourceCommentConfig,
  SourceLocation,
  TrackedPool,
  TrackedPoolClient,
} from 'pg-source-comments';
```

## Development

```bash
# Install dependencies
npm install

# Run tests
npm test

# Type check
npm run typecheck

# Build
npm run build
```

## Why Prepend Instead of Append?

Database query logs often truncate long queries. Appending comments at the end means they get cut off. Prepending ensures the source location is always visible, even when the query itself is truncated.

## License

[Do No Harm](https://github.com/raisely/NoHarm)
