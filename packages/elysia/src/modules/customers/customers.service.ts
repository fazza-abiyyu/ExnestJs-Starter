import type { PrismaClient } from '@prisma/client';
import { ODataError } from '../../lib/exception/index.js';
import { paginateList, type PaginatedResult } from '../../lib/odata/pagination.js';
import type { CustomerData, CustomerResponse } from './customers.interface.js';
import type { CreateCustomerDto, UpdateCustomerDto } from './customers.dto.js';

function mapCustomerResponse(customerData: CustomerData): CustomerResponse {
  return {
    id: customerData.id,
    tenant_id: customerData.tenantId,
    name: customerData.name,
    created_at: customerData.createdAt.toISOString(),
    updated_at: customerData.updatedAt.toISOString(),
  };
}

export class CustomersService {
  constructor(private readonly prisma: PrismaClient) {}

  async listCustomers(
    tenantId: string,
    query: Record<string, unknown>,
  ): Promise<PaginatedResult<CustomerResponse>> {
    const where = { tenantId };
    const { items, total, skip, take } = await paginateList<CustomerData>(
      (args) => this.prisma.customer.findMany(args),
      (args) => this.prisma.customer.count(args),
      where,
      { query, defaultTop: 20 },
    );
    return { items: items.map(mapCustomerResponse), total, skip, take };
  }

  async getCustomer(
    tenantId: string,
    customerId: string,
    options?: { lang?: string },
  ): Promise<CustomerResponse> {
    const existingCustomer = await this.prisma.customer.findUnique({
      where: { id: customerId, tenantId },
    });
    if (!existingCustomer) {
      throw new ODataError('CustomerNotFound', 'Customer not found', 404, options?.lang);
    }
    return mapCustomerResponse(existingCustomer);
  }

  async createCustomer(
    tenantId: string,
    createCustomerDto: CreateCustomerDto,
    options?: { lang?: string },
  ): Promise<CustomerResponse> {
    const existingCustomer = await this.prisma.customer.findFirst({
      where: { tenantId, name: createCustomerDto.name },
    });
    if (existingCustomer) {
      throw new ODataError('CustomerDuplicate', 'Customer already exists', 409, options?.lang);
    }
    const createdCustomer = await this.prisma.customer.create({
      data: { tenantId, ...createCustomerDto },
    });
    return mapCustomerResponse(createdCustomer);
  }

  async updateCustomer(
    tenantId: string,
    customerId: string,
    updateCustomerDto: UpdateCustomerDto,
    options?: { lang?: string },
  ): Promise<CustomerResponse> {
    const existingCustomer = await this.prisma.customer.findUnique({
      where: { id: customerId, tenantId },
    });
    if (!existingCustomer) {
      throw new ODataError('CustomerNotFound', 'Customer not found', 404, options?.lang);
    }
    const updateData: Record<string, unknown> = {};
    if (updateCustomerDto.name !== undefined) updateData.name = updateCustomerDto.name;
    if (Object.keys(updateData).length === 0) {
      throw new ODataError('BadRequest', 'At least one field must be provided', 400, options?.lang);
    }
    const updatedCustomer = await this.prisma.customer.update({
      where: { id: customerId },
      data: updateData,
    });
    return mapCustomerResponse(updatedCustomer);
  }

  async archiveCustomer(
    tenantId: string,
    customerId: string,
    options?: { lang?: string },
  ): Promise<{ id: string }> {
    const existingCustomer = await this.prisma.customer.findUnique({
      where: { id: customerId, tenantId },
    });
    if (!existingCustomer) {
      throw new ODataError('CustomerNotFound', 'Customer not found', 404, options?.lang);
    }
    await this.prisma.customer.delete({ where: { id: customerId } });
    return { id: customerId };
  }
}
