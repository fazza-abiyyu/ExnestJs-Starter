import type { Elysia } from 'elysia';
import { mountRoutes } from '../../lib/endpoint/index.js';
import { registerCustomersTranslations } from './customers.i18n.js';
import { CustomersService } from './customers.service.js';
import { CustomersController } from './customers.controller.js';
import { customersRoutes } from '../../endpoints/customers/customers.endpoint.js';
import { va } from '../../infrastructure/database/va.js';

export function buildCustomersModule(app: Elysia): Elysia {
  registerCustomersTranslations();

  const customerRepo = va.repository<any>('Customer');
  const customersService = new CustomersService(customerRepo);
  const customersController = new CustomersController(customersService);

  return mountRoutes(app, customersController, customersRoutes);
}
