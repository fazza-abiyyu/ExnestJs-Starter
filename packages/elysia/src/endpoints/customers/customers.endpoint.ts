import type { RouteConfig } from '../../lib/endpoint/index.js'
import { createCustomerSchema, updateCustomerSchema } from '../../modules/customers/customers.dto.js'

export const customersRoutes: RouteConfig[] = [
  {
    method: 'GET',
    path: '/api/v1/customers',
    handler: 'listCustomers',
    tags: ['Customers'],
    responses: [
      { status: 200, description: 'List of customers' },
      { status: 401, description: 'Unauthorized' },
    ],
  },
  {
    method: 'POST',
    path: '/api/v1/customers',
    handler: 'createCustomer',
    schema: { body: createCustomerSchema },
    tags: ['Customers'],
    responses: [
      { status: 201, description: 'Customer created' },
      { status: 400, description: 'Validation error' },
      { status: 409, description: 'Customer duplicate' },
    ],
  },
  {
    method: 'GET',
    path: '/api/v1/customers/:customer_id',
    handler: 'getCustomer',
    tags: ['Customers'],
    responses: [
      { status: 200, description: 'Customer details' },
      { status: 404, description: 'Customer not found' },
    ],
  },
  {
    method: 'PATCH',
    path: '/api/v1/customers/:customer_id',
    handler: 'updateCustomer',
    schema: { body: updateCustomerSchema },
    tags: ['Customers'],
    responses: [
      { status: 200, description: 'Customer updated' },
      { status: 400, description: 'Validation error' },
      { status: 404, description: 'Customer not found' },
    ],
  },
  {
    method: 'POST',
    path: '/api/v1/customers/:customer_id/archive',
    handler: 'archiveCustomer',
    tags: ['Customers'],
    responses: [
      { status: 200, description: 'Customer archived' },
      { status: 404, description: 'Customer not found' },
    ],
  },
]