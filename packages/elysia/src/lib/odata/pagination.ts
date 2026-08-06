import { parseODataQuery, type ODataPrismaQuery } from './query.js';

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
  include?: Record<string, any>;
  select?: Record<string, any>;
}

function resolveOrderBy(
  prismaQuery: ODataPrismaQuery,
  defaultOrderBy?: Record<string, 'asc' | 'desc'> | Record<string, 'asc' | 'desc'>[],
) {
  if (prismaQuery.orderBy) return prismaQuery.orderBy;
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
  findMany: (args: any) => Promise<TItem[]>,
  count: (args: any) => Promise<number>,
  where: Record<string, unknown>,
  options: ODataListArgs,
): Promise<PaginatedResult<TItem>> {
  const prismaQuery = parseODataQuery(options.query);

  const take = prismaQuery.take ?? options.defaultTop;
  const skip = prismaQuery.skip ?? 0;

  const orderBy = resolveOrderBy(prismaQuery, options.defaultOrderBy);

  const findArgs: Record<string, any> = {
    where,
    orderBy,
  };

  if (take !== undefined && take > 0) {
    findArgs.take = take;
  }
  if (skip !== undefined && skip > 0) {
    findArgs.skip = skip;
  }

  if (options.include) {
    findArgs.include = options.include;
  }
  if (options.select) {
    findArgs.select = options.select;
  }

  const [items, total] = await Promise.all([findMany(findArgs), count({ where })]);

  return { items, total, skip, take };
}
