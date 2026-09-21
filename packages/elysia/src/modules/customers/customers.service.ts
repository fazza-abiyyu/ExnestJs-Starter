import type { Repository } from '@v-va/orm';
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
  constructor(private readonly customerRepo: Repository<CustomerData>) {}

  async listCustomers(
    tenantId: string,
    query: Record<string, unknown>,
  ): Promise<PaginatedResult<CustomerResponse>> {
    const where = { tenantId } as Partial<CustomerData>;
    const { items, total, skip, take } = await paginateList<CustomerData>(
      (args) => this.customerRepo.findMany({ where, orderBy: args.orderBy, limit: args.limit, offset: args.offset }),
      (w) => this.customerRepo.count(w as Partial<CustomerData>),
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
    const existingCustomer = await this.customerRepo.findUnique({
      id: customerId,
      tenantId,
    } as Partial<CustomerData>);
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
    const existingCustomer = await this.customerRepo.findFirst({
      tenantId,
      name: createCustomerDto.name,
    } as Partial<CustomerData>);
    if (existingCustomer) {
      throw new ODataError('CustomerDuplicate', 'Customer already exists', 409, options?.lang);
    }
    const createdCustomer = await this.customerRepo.create({
      tenantId,
      ...createCustomerDto,
    } as Partial<CustomerData>);
    return mapCustomerResponse(createdCustomer);
  }

  async updateCustomer(
    tenantId: string,
    customerId: string,
    updateCustomerDto: UpdateCustomerDto,
    options?: { lang?: string },
  ): Promise<CustomerResponse> {
    const existingCustomer = await this.customerRepo.findUnique({
      id: customerId,
      tenantId,
    } as Partial<CustomerData>);
    if (!existingCustomer) {
      throw new ODataError('CustomerNotFound', 'Customer not found', 404, options?.lang);
    }
    const updateData: Record<string, unknown> = {};
    if (updateCustomerDto.name !== undefined) updateData.name = updateCustomerDto.name;
    if (Object.keys(updateData).length === 0) {
      throw new ODataError('BadRequest', 'At least one field must be provided', 400, options?.lang);
    }
    const updatedCustomer = await this.customerRepo.update(
      { id: customerId } as Partial<CustomerData>,
      updateData as Partial<CustomerData>,
    );
    return mapCustomerResponse(updatedCustomer);
  }

  async archiveCustomer(
    tenantId: string,
    customerId: string,
    options?: { lang?: string },
  ): Promise<{ id: string }> {
    const existingCustomer = await this.customerRepo.findUnique({
      id: customerId,
      tenantId,
    } as Partial<CustomerData>);
    if (!existingCustomer) {
      throw new ODataError('CustomerNotFound', 'Customer not found', 404, options?.lang);
    }
    await this.customerRepo.delete({ id: customerId } as Partial<CustomerData>);
    return { id: customerId };
  }
}
