export interface Product {
  id: number;
  name: string;
  metadata: any;
}

export type ProductWhereInput = {
  AND?: ProductWhereInput[];
  OR?: ProductWhereInput[];
  NOT?: ProductWhereInput | ProductWhereInput[];
  id?:
    | number
    | {
        equals?: number;
        not?: number;
        in?: number[];
        notIn?: number[];
        lt?: number;
        lte?: number;
        gt?: number;
        gte?: number;
        contains?: string;
        startsWith?: string;
        endsWith?: string;
        mode?: 'default' | 'insensitive';
      }
    | null;
  name?:
    | string
    | {
        equals?: string;
        not?: string;
        in?: string[];
        notIn?: string[];
        lt?: string;
        lte?: string;
        gt?: string;
        gte?: string;
        contains?: string;
        startsWith?: string;
        endsWith?: string;
        mode?: 'default' | 'insensitive';
      }
    | null;
  metadata?:
    | any
    | {
        path?: string | Array<string | number>;
        equals?: any;
        not?: any;
        in?: any[];
        notIn?: any[];
        lt?: any;
        lte?: any;
        gt?: any;
        gte?: any;
        contains?: string;
        startsWith?: string;
        endsWith?: string;
        mode?: 'default' | 'insensitive';
        arrayContains?: any;
        exists?: boolean;
      }
    | null;
};

export type ProductSelect = {
  id?: boolean;
  name?: boolean;
  metadata?: boolean;
};

export type ProductInclude = {};

export type ProductUniqueWhere = {
  id?: number;
};

export type ProductCreateInput = {
  id?: number;
  name: string;
  metadata: any;
};

export type ProductUpdateInput = {
  id?: number | { set?: number; increment?: number; decrement?: number };
  name?: string | { set?: string };
  metadata?: any | { set?: any };
};
