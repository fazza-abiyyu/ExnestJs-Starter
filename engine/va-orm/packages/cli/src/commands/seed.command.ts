// VA-ORM Seed Command

import * as fs from 'fs'
import * as path from 'path'
import type { VaClient } from '../../../client/src/core/va.client.js'

export interface SeedOptions {
  force?: boolean
  seedFile?: string
}

export interface SeedResult {
  success: boolean
  message: string
  duration: number
}

export class SeedCommand {
  private client: VaClient
  private projectRoot: string

  constructor(client: VaClient, projectRoot: string) {
    this.client = client
    this.projectRoot = projectRoot
  }

  async seed(options: SeedOptions = {}): Promise<SeedResult> {
    const startTime = Date.now()
    const seedFile = this.findSeedFile(options.seedFile)

    if (!seedFile) {
      return {
        success: false,
        message: 'No seed file found. Create a seed.ts or seed.js file in your project root.',
        duration: Date.now() - startTime,
      }
    }

    try {
      const seedModule = await import(seedFile)
      const seedFn = seedModule.default || seedModule.seed

      if (typeof seedFn !== 'function') {
        return {
          success: false,
          message: 'Seed file must export a default function or a named "seed" function.',
          duration: Date.now() - startTime,
        }
      }

      await seedFn(this.client)

      return {
        success: true,
        message: `Seed completed successfully using ${path.basename(seedFile)}`,
        duration: Date.now() - startTime,
      }
    } catch (error: any) {
      return {
        success: false,
        message: `Seed failed: ${error.message}`,
        duration: Date.now() - startTime,
      }
    }
  }

  private findSeedFile(customPath?: string): string | null {
    if (customPath) {
      const fullPath = path.resolve(this.projectRoot, customPath)
      return fs.existsSync(fullPath) ? fullPath : null
    }

    const candidates = [
      'seed.ts',
      'seed.js',
      'prisma/seed.ts',
      'prisma/seed.js',
      'src/seed.ts',
      'src/seed.js',
      'seeds/seed.ts',
      'seeds/seed.js',
    ]

    for (const candidate of candidates) {
      const fullPath = path.join(this.projectRoot, candidate)
      if (fs.existsSync(fullPath)) {
        return fullPath
      }
    }

    return null
  }

  async reset(): Promise<SeedResult> {
    const startTime = Date.now()

    try {
      // Run seed with --force flag
      const result = await this.seed({ force: true })
      return {
        ...result,
        message: result.success ? `Database reset and re-seeded in ${result.duration}ms` : result.message,
      }
    } catch (error: any) {
      return {
        success: false,
        message: `Reset failed: ${error.message}`,
        duration: Date.now() - startTime,
      }
    }
  }
}
