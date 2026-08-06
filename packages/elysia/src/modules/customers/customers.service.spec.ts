import { describe, expect, test, mock } from 'bun:test';
import { CustomersService } from './customers.service.js';

const mockRecord = {
  id: 'customer-1',
  tenantId: 'tenant-1',
  name: 'Test Customer',
  createdAt: new Date('2024-01-01T00:00:00Z'),
  updatedAt: new Date('2024-01-01T00:00:00Z'),
};

function createService() {
  const mockPrisma = {
    customer: {
      findMany: mock<(...args: any[]) => Promise<any>>(() => Promise.resolve([])),
      findUnique: mock<(...args: any[]) => Promise<any>>(() => Promise.resolve(null)),
      findFirst: mock<(...args: any[]) => Promise<any>>(() => Promise.resolve(null)),
      create: mock<(...args: any[]) => Promise<any>>(() => Promise.resolve(mockRecord)),
      update: mock<(...args: any[]) => Promise<any>>(() => Promise.resolve(mockRecord)),
      delete: mock<(...args: any[]) => Promise<any>>(() => Promise.resolve(mockRecord)),
      count: mock<(...args: any[]) => Promise<any>>(() => Promise.resolve(0)),
    },
  };
  const service = new CustomersService(mockPrisma as never);
  return { mockPrisma, service };
}

describe('CustomersService', () => {
  describe('listCustomers', () => {
    test('should return list of customers', async () => {
      const { mockPrisma, service } = createService();
      mockPrisma.customer.findMany.mockResolvedValueOnce([mockRecord]);
      mockPrisma.customer.count.mockResolvedValueOnce(1);

      const result = await service.listCustomers('tenant-1', {});

      expect(result.items).toHaveLength(1);
      expect(result.items[0].name).toBe('Test Customer');
    });

    test('should return empty when no records exist', async () => {
      const { service } = createService();

      const result = await service.listCustomers('tenant-1', {});

      expect(result.items).toEqual([]);
    });
  });

  describe('getCustomer', () => {
    test('should return customer detail', async () => {
      const { mockPrisma, service } = createService();
      mockPrisma.customer.findUnique.mockResolvedValueOnce(mockRecord);

      const result = await service.getCustomer('tenant-1', 'customer-1');

      expect(result.id).toBe('customer-1');
      expect(result.name).toBe('Test Customer');
    });

    test('should throw ODataError 404 when not found', () => {
      const { service } = createService();

      expect(service.getCustomer('tenant-1', 'missing')).rejects.toMatchObject({
        code: 'CustomerNotFound',
        status: 404,
      });
    });
  });

  describe('createCustomer', () => {
    test('should create a new customer', async () => {
      const { mockPrisma, service } = createService();
      mockPrisma.customer.create.mockResolvedValueOnce(mockRecord);

      const result = await service.createCustomer('tenant-1', { name: 'Test Customer' });

      expect(result.name).toBe('Test Customer');
    });

    test('should throw ODataError 409 when duplicate', () => {
      const { mockPrisma, service } = createService();
      mockPrisma.customer.findFirst.mockResolvedValueOnce(mockRecord);

      expect(service.createCustomer('tenant-1', { name: 'Test Customer' })).rejects.toMatchObject({
        code: 'CustomerDuplicate',
        status: 409,
      });
    });
  });

  describe('updateCustomer', () => {
    test('should update customer fields', async () => {
      const { mockPrisma, service } = createService();
      mockPrisma.customer.findUnique.mockResolvedValueOnce(mockRecord);
      mockPrisma.customer.update.mockResolvedValueOnce({ ...mockRecord, name: 'Updated' });

      const result = await service.updateCustomer('tenant-1', 'customer-1', { name: 'Updated' });

      expect(result.name).toBe('Updated');
    });

    test('should throw ODataError 404 when not found', () => {
      const { service } = createService();

      expect(service.updateCustomer('tenant-1', 'missing', { name: 'X' })).rejects.toMatchObject({
        code: 'CustomerNotFound',
        status: 404,
      });
    });
  });

  describe('archiveCustomer', () => {
    test('should archive a customer', async () => {
      const { mockPrisma, service } = createService();
      mockPrisma.customer.findUnique.mockResolvedValueOnce(mockRecord);

      const result = await service.archiveCustomer('tenant-1', 'customer-1');

      expect(result.id).toBe('customer-1');
    });

    test('should throw ODataError 404 when not found', () => {
      const { service } = createService();

      expect(service.archiveCustomer('tenant-1', 'missing')).rejects.toMatchObject({
        code: 'CustomerNotFound',
        status: 404,
      });
    });
  });
});
