import { VaClient, type VaClientOptions } from '@v-va/orm';
import { config } from '../config/index.js';

const baseOptions: VaClientOptions = {
  driver: 'postgres',
  dsn: config.databaseUrl,
  models: {
    Customer: { tableName: 'customer' },
  },
  modelOptions: {
    Customer: { updatedAtField: 'updatedAt' },
  },
};

export const va = VaClient.create(baseOptions);
