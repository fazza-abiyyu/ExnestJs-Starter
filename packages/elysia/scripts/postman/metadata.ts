import type { CustomScenario } from '../generate-postman.js'

export const metadataScenarios: Record<string, CustomScenario[]> = {
  'GET /$metadata': [
    {
      name: 'Success',
      expect: { status: 200 },
    },
  ],
  'GET /$metadata/:fragment': [
    {
      name: 'Success - Health',
      params: { fragment: 'Health' },
      expect: { status: 200, body: { 'value.name': 'Health' } },
    },
    {
      name: 'Success - User',
      params: { fragment: 'User' },
      expect: { status: 200, body: { 'value.name': 'User' } },
    },
    {
      name: 'Not found',
      params: { fragment: 'NonExistent' },
      expect: { status: 404, body: { 'error.code': 'EntityTypeNotFound' } },
    },
  ],
}