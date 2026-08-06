import type { Elysia } from 'elysia'
import { mountRoutes } from '../../lib/endpoint/index.js'
import { registerCustomersTranslations } from './customers.i18n.js'
import { CustomersService } from './customers.service.js'
import { CustomersController } from './customers.controller.js'
import { customersRoutes } from '../../endpoints/customers/customers.endpoint.js'
import { prisma } from '../../infrastructure/database/prisma.js'

export function buildCustomersModule(app: Elysia): Elysia {
  registerCustomersTranslations()

  const customersService = new CustomersService(prisma)
  const customersController = new CustomersController(customersService)

  return mountRoutes(app, customersController, customersRoutes)
}