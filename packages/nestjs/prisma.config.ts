import 'dotenv/config';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { defineConfig } from 'prisma/config';

let packageName = 'app';
try {
  const pkg = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf-8'));
  packageName = pkg.name?.replace(/[^a-zA-Z0-9_-]/g, '') ?? 'app';
} catch {
  // fallback
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: process.env['DATABASE_URL'] ?? `postgresql://localhost:5432/${packageName}`,
  },
});
