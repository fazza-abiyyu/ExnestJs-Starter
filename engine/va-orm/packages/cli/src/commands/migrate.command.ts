// VA-ORM Migrate Command

import { Migrator } from '../../../client/src/migration/migrator.js';
import { createDriverFromUrl, requireMigratorUrl } from './driver.factory.js';
import * as fs from 'fs/promises';
import * as path from 'path';

export interface MigrateOptions {
  command: 'up' | 'down' | 'status' | 'reset' | 'create' | 'dev' | 'resolve';
  steps?: number;
  name?: string;
  to?: 'applied' | 'rolled-back';
  schema?: string;
  migrationsDir?: string;
}

export async function migrateCommand(options: MigrateOptions): Promise<void> {
  const migrationsDir = options.migrationsDir || './migrations';

  // DDL -> pakai DSN migrator (bisa dipisah dari role aplikasi).
  const connectionString = requireMigratorUrl();

  // Driver sesuai transport DSN (postgres / mysql / sqlite / http).
  const driver = await createDriverFromUrl(connectionString);

  const migrator = new Migrator(driver, migrationsDir);

  try {
    switch (options.command) {
      case 'up': {
        console.log('Running migrations...');
        const applied = await migrator.migrate();
        if (applied.length === 0) {
          console.log('No pending migrations');
        } else {
          for (const migration of applied) {
            console.log(`  ✓ Applied: ${migration.name}`);
          }
        }
        break;
      }

      case 'down': {
        const steps = options.steps || 1;
        console.log(`Rolling back ${steps} migration(s)...`);
        const rolledBack = await migrator.rollback(steps);
        if (rolledBack.length === 0) {
          console.log('No migrations to rollback');
        } else {
          for (const migration of rolledBack) {
            console.log(`  ✓ Rolled back: ${migration.name}`);
          }
        }
        break;
      }

      case 'status': {
        console.log('Migration status:');
        const status = await migrator.status();

        if (status.applied.length > 0) {
          console.log('\n  Applied:');
          for (const migration of status.applied) {
            console.log(`    ✓ ${migration.name}`);
          }
        }

        if (status.pending.length > 0) {
          console.log('\n  Pending:');
          for (const migration of status.pending) {
            console.log(`    ○ ${migration.name}`);
          }
        }

        if (status.applied.length === 0 && status.pending.length === 0) {
          console.log('  No migrations found');
        }
        break;
      }

      case 'reset': {
        console.log('Resetting database...');
        await migrator.reset();
        console.log('  ✓ Database reset complete');
        break;
      }

      case 'create': {
        if (!options.name) {
          console.error('\x1b[31mError: Migration name is required\x1b[0m');
          process.exit(1);
        }
        const filePath = await migrator.createMigration(options.name);
        console.log(`  ✓ Created migration: ${filePath}`);
        break;
      }

      case 'dev': {
        if (!options.name) {
          console.error('\x1b[31mError: Migration name is required\x1b[0m');
          process.exit(1);
        }
        console.log(`Creating dev migration: ${options.name}`);
        const { file, applied } = await migrator.dev(options.name);
        console.log(`  ✓ Created migration: ${file}`);
        if (applied.length === 0) {
          console.log('No pending migrations');
        } else {
          for (const migration of applied) {
            console.log(`  ✓ Applied: ${migration.name}`);
          }
        }
        break;
      }

      case 'resolve': {
        if (!options.name) {
          console.error('\x1b[31mError: Migration name is required\x1b[0m');
          process.exit(1);
        }
        const to = options.to || 'applied';
        await migrator.resolve(options.name, to);
        console.log(`  ✓ Marked ${options.name} as ${to}`);
        break;
      }
    }
  } catch (error) {
    console.error('\x1b[31mError:\x1b[0m', error);
    process.exit(1);
  } finally {
    await driver.close();
  }
}
