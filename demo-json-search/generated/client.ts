import { VaClient } from '@v-va/orm';
import { ModelDelegate } from '@v-va/orm';
import type { SchemaAST } from '@v-va/orm/schema';
import type {
  Product,
  ProductWhereInput,
  ProductSelect,
  ProductInclude,
  ProductUniqueWhere,
  ProductCreateInput,
  ProductUpdateInput,
} from './types';

export interface VaClientConfig {
  connectionString: string;
  pooling?: boolean;
}

const schema: SchemaAST = {
  generator: [{ name: 'client', provider: 'va-client-js', output: './generated' }],
  datasource: [{ name: 'db', provider: 'sqlite', url: 'file:./local.db' }],
  model: [
    {
      name: 'Product',
      fields: [
        {
          name: 'id',
          type: 'Int',
          isArray: false,
          isOptional: false,
          attributes: [
            { name: '@id', args: {} },
            { name: '@default', args: { autoincrement: true } },
          ],
        },
        { name: 'name', type: 'String', isArray: false, isOptional: false, attributes: [] },
        { name: 'metadata', type: 'Json', isArray: false, isOptional: false, attributes: [] },
      ],
      attributes: [{ name: '@@map', args: { '"products"': true } }],
      tableName: 'products',
    },
  ],
  enum: [],
  view: [],
};

export class ProductDelegate extends ModelDelegate<Product> {
  findMany(args?: {
    where?: ProductWhereInput;
    orderBy?: Record<string, 'asc' | 'desc'>;
    take?: number;
    skip?: number;
    select?: ProductSelect;
    include?: ProductInclude;
  }): Promise<Product[]> {
    return super.findMany(args ?? {});
  }
  findUnique(args: {
    where: ProductWhereInput;
    select?: ProductSelect;
    include?: ProductInclude;
  }): Promise<Product | null> {
    return super.findUnique(args);
  }
  findFirst(args?: {
    where?: ProductWhereInput;
    orderBy?: Record<string, 'asc' | 'desc'>;
    take?: number;
    skip?: number;
    select?: ProductSelect;
    include?: ProductInclude;
  }): Promise<Product | null> {
    return super.findFirst(args ?? {});
  }
  count(where?: ProductWhereInput): Promise<number> {
    return super.count(where);
  }
  aggregate(args?: {
    where?: ProductWhereInput;
    _count?: boolean | { _all?: boolean } | string[];
    _sum?: string[];
    _avg?: string[];
    _min?: string[];
    _max?: string[];
  }): Promise<Record<string, any>> {
    return super.aggregate(args);
  }
  groupBy(args: {
    by: string[];
    where?: ProductWhereInput;
    _count?: boolean | { _all?: boolean } | string[];
    _sum?: string[];
    _avg?: string[];
    _min?: string[];
    _max?: string[];
    having?: Record<string, any>;
    orderBy?: Record<string, 'asc' | 'desc'>;
    take?: number;
    skip?: number;
  }): Promise<Record<string, any>[]> {
    return super.groupBy(args);
  }
  create(args: { data: ProductCreateInput; include?: ProductInclude }): Promise<Product> {
    return super.create(args) as Promise<Product>;
  }
  update(args: {
    where: ProductUniqueWhere;
    data: ProductUpdateInput;
    include?: ProductInclude;
  }): Promise<Product[]> {
    return super.update(args as any) as Promise<Product[]>;
  }
}

export class VaClientGenerated extends VaClient {
  constructor(config: VaClientConfig) {
    super({
      driver: 'sqlite',
      dsn: config.connectionString,
      pooling: config.pooling ?? true,
      schema,
    });
  }

  get product(): ProductDelegate {
    return this.delegate('Product', ProductDelegate);
  }
}
