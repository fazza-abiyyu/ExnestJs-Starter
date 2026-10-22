// VA-ORM DB Push Command
//
// Generates DDL from va.schema and applies it directly to the database.

import { SchemaParser } from '../../../schema/src/schema.parser.js';
import { SqlGenerator } from '../generator/sql.generator.js';
import { diffStatements } from '../generator/schema.differ.js';
import {
  createDriverFromUrl,
  requireMigratorUrl,
  datasourceToProvider,
  detectProvider,
} from './driver.factory.js';
import * as fs from 'fs/promises';
import * as path from 'path';

export interface PushOptions {
  schema?: string;
  dryRun?: boolean;
}

export async function pushCommand(options: PushOptions): Promise<void> {
  const schemaPath = options.schema || 'va.schema';
  console.log(`Pushing schema to database: ${schemaPath}`);

  const content = await fs.readFile(path.resolve(schemaPath), 'utf-8');
  const ast = new SchemaParser().parse(content);

  const datasourceProvider = ast.datasource[0]?.provider ?? 'postgresql';
  const generator = new SqlGenerator(datasourceToProvider(datasourceProvider));
  const ddl = generator.generateDDL(ast);

  const connectionString = requireMigratorUrl();
  const driver = await createDriverFromUrl(connectionString);

  try {
    const provider = detectProvider(connectionString);
    // Transport http: engine remote bisa postgres atau sqlite — ikut driver.
    const dialect =
      provider === 'http' ? (driver.getDialect() as 'postgres' | 'mysql' | 'sqlite') : provider;
    const { statements, warnings } = await diffStatements(ddl, driver, dialect);

    if (options.dryRun) {
      console.log('-- dry run: statements that would execute --');
      for (const statement of statements) {
        console.log(statement + ';');
      }
    } else {
      for (const statement of statements) {
        await driver.execute(statement);
        const firstLine = statement.split('\n')[0];
        console.log(`  ✓ Executed: ${firstLine.slice(0, 80)}`);
      }
    }
    for (const warning of warnings) {
      console.log(`  ! Warning: ${warning}`);
    }
    console.log(
      options.dryRun
        ? '\x1b[32m✓ Dry run complete (nothing executed)\x1b[0m'
        : '\x1b[32m✓ Schema pushed successfully\x1b[0m',
    );
  } catch (error) {
    reportPushError(error);
    process.exit(1);
  } finally {
    await driver.close();
  }
}

/**
 * Pesan error yang bisa dibaca buat kasus umum.
 *
 * Pola setup yang paling sering: role aplikasi (R/W) dipakai untuk `db push`,
 * padahal DDL butuh role lain → error "permission denied" dari Postgres.
 */
function reportPushError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);

  if (/permission denied|42501|not authorized|insufficient privilege/i.test(message)) {
    console.error('\x1b[31m✗ DDL ditolak: role ini tidak punya hak CREATE\x1b[0m');
    console.error('  → pakai DSN dengan hak DDL:');
    console.error('      MIGRATOR_DATABASE_URL=postgresql://<role-ddl>@host/db va db push');
    console.error(`\n  detail: ${message.split('\n')[0]}`);
    return;
  }

  if (/could not connect|ECONNREFUSED|ETIMEDOUT|timeout/i.test(message)) {
    console.error('\x1b[31m✗ Tidak bisa konek ke database\x1b[0m');
    console.error(`  detail: ${message.split('\n')[0]}`);
    return;
  }

  console.error(`\x1b[31m✗ db push gagal: ${message.split('\n')[0]}\x1b[0m`);
}
