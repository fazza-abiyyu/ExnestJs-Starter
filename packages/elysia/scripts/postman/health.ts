import type { CustomScenario } from '../generate-postman.js'

import { readFileSync } from 'fs'
import { resolve } from 'path'

const pkg = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf-8'))
const appName = pkg.name ?? 'unnamed'

export const healthScenarios: Record<string, CustomScenario[]> = {
  'GET /health/live': [
    {
      name: 'Success',
      expect: {
        status: 200,
        body: {
          'data.status': 'ok',
          'data.service': appName,
        },
      },
    },
  ],
  'GET /health/ready': [
    {
      name: 'Success',
      expect: {
        status: 200,
        body: {
          'data.status': 'ok',
          'data.checks.database.status': 'ok',
        },
      },
    },
  ],
}