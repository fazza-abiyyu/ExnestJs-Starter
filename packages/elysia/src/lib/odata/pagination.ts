import { parseODataQuery, type ODataListQuery } from './query.js';

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  skip: number;
  take?: number;
}

export interface ODataListArgs {
  query: Record<string, unknown>;
  defaultOrderBy?: Record<string, 'asc' | 'desc'> | Record<string, 'asc' | 'desc'>[];
  defaultTop?: number;
}

function resolveOrderBy(
  listQuery: ODataListQuery,
  defaultOrderBy?: Record<string, 'asc' | 'desc'> | Record<string, 'asc' | 'desc'>[],
) {
  if (listQuery.orderBy) return listQuery.orderBy;
  if (defaultOrderBy) return defaultOrderBy;
  return { id: 'desc' as const };
}

export function buildNextLink(
  basePath: string,
  query: Record<string, unknown>,
  currentSkip: number,
  top: number | undefined,
  total: number,
): string | undefined {
  if (!top || top <= 0) return undefined;

  const nextSkip = currentSkip + top;
  if (nextSkip >= total) return undefined;

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (key === '$skip' || key === '$top') continue;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      params.set(key, String(value));
    }
  }
  params.set('$top', String(top));
  params.set('$skip', String(nextSkip));

  const qs = params.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}

export async function paginateList<TItem>(
  findMany: (args: {
    where?: Record<string, unknown>;
    orderBy?: Record<string, 'asc' | 'desc'>;
    limit?: number;
    offset?: number;
  }) => Promise<TItem[]>,
  count: (where?: Record<string, unknown>) => Promise<number>,
  where: Record<string, unknown>,
  options: ODataListArgs,
): Promise<PaginatedResult<TItem>> {
  const listQuery = parseODataQuery(options.query);

  const take = listQuery.take ?? options.defaultTop;
  const skip = listQuery.skip ?? 0;

  const orderByRaw = resolveOrderBy(listQuery, options.defaultOrderBy);
  const orderBy = Array.isArray(orderByRaw) ? orderByRaw[0] : orderByRaw;

  const findArgs: {
    where?: Record<string, unknown>;
    orderBy?: Record<string, 'asc' | 'desc'>;
    limit?: number;
    offset?: number;
  } = {
    where,
    orderBy,
  };

  if (take !== undefined && take > 0) {
    findArgs.limit = take;
  }
  if (skip !== undefined && skip > 0) {
    findArgs.offset = skip;
  }

  const [items, total] = await Promise.all([findMany(findArgs), count(where)]);

  return { items, total, skip, take };
}
