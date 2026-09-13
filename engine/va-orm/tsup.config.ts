import { defineConfig } from 'tsup';

// Single-package bundle: cross-package relative imports (client -> schema)
// are inlined, so consumers never resolve files outside dist/.
const shared = {
  format: ['esm'] as const,
  target: 'node18',
  sourcemap: true,
  external: ['pg', 'mysql2', 'better-sqlite3', 'bun:sqlite'],
  dts: {
    compilerOptions: {
      module: 'esnext',
      moduleResolution: 'bundler',
      target: 'es2022',
      strict: true,
      skipLibCheck: true,
    },
  },
};

export default defineConfig([
  {
    ...shared,
    entry: {
      index: 'packages/client/src/index.ts',
      'integrations/nestjs/index': 'packages/client/src/integrations/nestjs/index.ts',
      'integrations/elysia/index': 'packages/client/src/integrations/elysia/index.ts',
      'schema/index': 'packages/schema/src/index.ts',
    },
    outDir: 'packages/client/dist',
  },
  {
    ...shared,
    entry: { index: 'packages/cli/src/index.ts' },
    outDir: 'packages/cli/dist',
  },
  {
    ...shared,
    entry: { va: 'packages/cli/bin/va.ts' },
    outDir: 'packages/cli/dist/bin',
    dts: false,
    banner: { js: '#!/usr/bin/env node' },
  },
]);
