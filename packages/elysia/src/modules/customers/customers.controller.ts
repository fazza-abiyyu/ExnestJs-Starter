import {
  ODataResponse,
  type ODataCollectionResponse,
  type ODataSingleResponse,
} from '../../lib/odata/index.js';
import { buildNextLink } from '../../lib/odata/pagination.js';
import { config } from '../../infrastructure/config/index.js';
import type { HandlerContext } from '../../lib/endpoint/index.js';
import { CustomersService } from './customers.service.js';
import type { CreateCustomerDto, UpdateCustomerDto } from './customers.dto.js';
import type { CustomerResponse } from './customers.interface.js';
import { registerCustomersTranslations } from './customers.i18n.js';

export class CustomersController {
  constructor(private readonly customersService: CustomersService) {
    registerCustomersTranslations();
  }

  private metadataUrl(fragment: string): string {
    return `${config.apiBaseUrl}/$metadata/${fragment}`;
  }

  private getTenantId(ctx: HandlerContext): string {
    return ctx.headers['x-tenant-id'] ?? 'default-tenant';
  }

  async listCustomers(ctx: HandlerContext): Promise<ODataCollectionResponse<CustomerResponse>> {
    const tenantId = this.getTenantId(ctx);
    const query: Record<string, unknown> = { ...ctx.query };
    const result = await this.customersService.listCustomers(tenantId, query);

    const basePath = `${config.apiBaseUrl}/api/v1/customers`;
    const nextLink = buildNextLink(basePath, query, result.skip, result.take, result.total);

    return ODataResponse.collection(result.items)
      .context(this.metadataUrl('Model.Customer'))
      .count(result.total)
      .nextLink(nextLink ?? '')
      .build();
  }

  async getCustomer(ctx: HandlerContext): Promise<ODataSingleResponse<CustomerResponse>> {
    const tenantId = this.getTenantId(ctx);
    const customerId = ctx.params.customer_id;
    const lang = ctx.query.lang;
    const record = await this.customersService.getCustomer(tenantId, customerId, { lang });
    return ODataResponse.item(record).context(this.metadataUrl('Model.Customer')).build();
  }

  async createCustomer(ctx: HandlerContext): Promise<ODataSingleResponse<CustomerResponse>> {
    const tenantId = this.getTenantId(ctx);
    const lang = ctx.query.lang;
    const createCustomerDto = ctx.body as CreateCustomerDto;
    const record = await this.customersService.createCustomer(tenantId, createCustomerDto, {
      lang,
    });
    ctx.set.status = 201;
    return ODataResponse.item(record).context(this.metadataUrl('Model.Customer')).build();
  }

  async updateCustomer(ctx: HandlerContext): Promise<ODataSingleResponse<CustomerResponse>> {
    const tenantId = this.getTenantId(ctx);
    const customerId = ctx.params.customer_id;
    const lang = ctx.query.lang;
    const updateCustomerDto = ctx.body as UpdateCustomerDto;
    const record = await this.customersService.updateCustomer(
      tenantId,
      customerId,
      updateCustomerDto,
      { lang },
    );
    return ODataResponse.item(record).context(this.metadataUrl('Model.Customer')).build();
  }

  async archiveCustomer(ctx: HandlerContext): Promise<ODataSingleResponse<{ id: string }>> {
    const tenantId = this.getTenantId(ctx);
    const customerId = ctx.params.customer_id;
    const lang = ctx.query.lang;
    const record = await this.customersService.archiveCustomer(tenantId, customerId, { lang });
    return ODataResponse.item(record).context(this.metadataUrl('Model.Customer')).build();
  }
}
