// VA-ORM CLI Commands Spec

import { describe, it, expect } from 'bun:test'
import { validateCommand } from '../commands/validate.command.js'
import { generateCommand } from '../commands/generate.command.js'
import { migrateCommand } from '../commands/migrate.command.js'

describe('CLI Commands', () => {
  describe('validateCommand', () => {
    it('should be a function', () => {
      expect(typeof validateCommand).toBe('function')
    })

    it('should accept options', () => {
      // Just test that the function accepts the correct parameters
      expect(validateCommand.length).toBe(1)
    })
  })

  describe('generateCommand', () => {
    it('should be a function', () => {
      expect(typeof generateCommand).toBe('function')
    })

    it('should accept options', () => {
      expect(generateCommand.length).toBe(1)
    })
  })

  describe('migrateCommand', () => {
    it('should be a function', () => {
      expect(typeof migrateCommand).toBe('function')
    })

    it('should accept options', () => {
      expect(migrateCommand.length).toBe(1)
    })
  })
})
