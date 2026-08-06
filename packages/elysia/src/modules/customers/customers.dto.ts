import { z } from 'zod'

export const createCustomerSchema = z.object({
  name: z.string().min(1, 'Name is required'),
})

export type CreateCustomerDto = z.infer<typeof createCustomerSchema>

export const updateCustomerSchema = z.object({
  name: z.string().min(1, 'Name is required').optional(),
})

export type UpdateCustomerDto = z.infer<typeof updateCustomerSchema>