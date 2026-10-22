// VA-ORM CLI Commands Spec

import { describe, it, expect } from 'bun:test';
import { validateCommand } from '../commands/validate.command.js';
import { generateCommand } from '../commands/generate.command.js';
import { migrateCommand } from '../commands/migrate.command.js';
import {
  detectProvider,
  datasourceToProvider,
  isHttpProvider,
  httpDialectFor,
} from '../commands/driver.factory.js';

describe('CLI Commands', () => {
  describe('validateCommand', () => {
    it('should be a function', () => {
      expect(typeof validateCommand).toBe('function');
    });

    it('should accept options', () => {
      // Just test that the function accepts the correct parameters
      expect(validateCommand.length).toBe(1);
    });
  });

  describe('generateCommand', () => {
    it('should be a function', () => {
      expect(typeof generateCommand).toBe('function');
    });

    it('should accept options', () => {
      expect(generateCommand.length).toBe(1);
    });
  });

  describe('migrateCommand', () => {
    it('should be a function', () => {
      expect(typeof migrateCommand).toBe('function');
    });

    it('should accept options', () => {
      expect(migrateCommand.length).toBe(1);
    });
  });

  describe('driver factory', () => {
    it('detects the transport from the DSN', () => {
      expect(detectProvider('https://ep-x.neon.tech')).toBe('http');
      expect(detectProvider('http://localhost:8787/sql')).toBe('http');
      expect(detectProvider('mysql://user:pass@localhost:3306/db')).toBe('mysql');
      expect(detectProvider('file:./data.db')).toBe('sqlite');
      expect(detectProvider('postgres://user:pass@localhost:5432/db')).toBe('postgres');
    });

    it('maps a datasource provider to a DDL dialect', () => {
      expect(datasourceToProvider('postgresql')).toBe('postgres');
      expect(datasourceToProvider('mysql')).toBe('mysql');
      expect(datasourceToProvider('sqlite')).toBe('sqlite');
      expect(datasourceToProvider('http')).toBe('postgres');
      expect(datasourceToProvider('http+sqlite')).toBe('sqlite');
    });

    it('recognises http providers', () => {
      expect(isHttpProvider('http')).toBe(true);
      expect(isHttpProvider('https')).toBe(true);
      expect(isHttpProvider('http+sqlite')).toBe(true);
      expect(isHttpProvider('postgresql')).toBe(false);
      expect(isHttpProvider(undefined)).toBe(false);
      expect(httpDialectFor('http+sqlite')).toBe('sqlite');
      expect(httpDialectFor('http')).toBe('postgres');
    });

    it('creates an http driver for an http(s) DSN', async () => {
      const { createDriverFromUrl } = await import('../commands/driver.factory.js');
      const driver = await createDriverFromUrl('https://ep-x.neon.tech/sql');
      expect(driver.getDialect()).toBe('postgres');
      expect(driver.getPlaceholder(1)).toBe('$1');
      await driver.close();
    });
  });
});
