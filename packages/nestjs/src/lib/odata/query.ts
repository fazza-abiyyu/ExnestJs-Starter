/**
 * Strongly-typed query options for OData V4.
 * T is the entity model type (e.g., Product, User).
 */
export interface ODataQueryOptions<T> {
  $filter?: string;
  $orderby?: string;
  $top?: number | string;
  $skip?: number | string;
  $select?: string;
  $expand?: string;
  $count?: boolean | string;
}

/**
 * Resulting Prisma-compatible query object.
 */
export interface ODataPrismaQuery {
  take?: number;
  skip?: number;
  orderBy?: Record<string, 'asc' | 'desc'> | Record<string, 'asc' | 'desc'>[];
  select?: Record<string, boolean>;
}

/**
 * Parses Express request query parameters into Prisma-compatible options.
 * Highly typed to assist developers during query execution.
 */
export function parseODataQuery<T>(query: Record<string, any>): ODataPrismaQuery {
  const prismaQuery: ODataPrismaQuery = {};

  // 1. Parse pagination: $top -> take, $skip -> skip
  if (query.$top !== undefined) {
    const top = parseInt(String(query.$top), 10);
    if (!isNaN(top)) {
      prismaQuery.take = top;
    }
  }

  if (query.$skip !== undefined) {
    const skip = parseInt(String(query.$skip), 10);
    if (!isNaN(skip)) {
      prismaQuery.skip = skip;
    }
  }

  // 2. Parse sorting: $orderby -> orderBy
  // Example: $orderby=createdAt desc,name asc
  if (query.$orderby) {
    const orderParts = String(query.$orderby).split(',');
    const orderByList: Record<string, 'asc' | 'desc'>[] = [];

    for (const part of orderParts) {
      const [field, direction] = part.trim().split(/\s+/);
      if (field) {
        const dir = direction?.toLowerCase() === 'desc' ? 'desc' : 'asc';
        orderByList.push({ [field]: dir });
      }
    }

    if (orderByList.length > 0) {
      prismaQuery.orderBy = orderByList.length === 1 ? orderByList[0] : orderByList;
    }
  }

  // 3. Parse selection: $select -> select
  // Example: $select=id,name
  if (query.$select) {
    const selectFields = String(query.$select).split(',');
    const selectObj: Record<string, boolean> = {};

    for (const field of selectFields) {
      const trimmed = field.trim();
      if (trimmed) {
        selectObj[trimmed] = true;
      }
    }

    if (Object.keys(selectObj).length > 0) {
      prismaQuery.select = selectObj;
    }
  }

  return prismaQuery;
}
