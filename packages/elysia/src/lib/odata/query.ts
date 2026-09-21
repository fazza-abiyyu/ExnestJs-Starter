export interface ODataQueryOptions {
  $filter?: string;
  $orderby?: string;
  $top?: number | string;
  $skip?: number | string;
  $select?: string;
  $expand?: string;
  $count?: boolean | string;
}

export interface ODataListQuery {
  take?: number;
  skip?: number;
  orderBy?: Record<string, 'asc' | 'desc'> | Record<string, 'asc' | 'desc'>[];
  select?: Record<string, boolean>;
}

export function parseODataQuery(query: Record<string, any>): ODataListQuery {
  const listQuery: ODataListQuery = {};

  if (query.$top !== undefined) {
    const top = parseInt(String(query.$top), 10);
    if (!isNaN(top)) {
      listQuery.take = top;
    }
  }

  if (query.$skip !== undefined) {
    const skip = parseInt(String(query.$skip), 10);
    if (!isNaN(skip)) {
      listQuery.skip = skip;
    }
  }

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
      listQuery.orderBy = orderByList.length === 1 ? orderByList[0] : orderByList;
    }
  }

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
      listQuery.select = selectObj;
    }
  }

  return listQuery;
}
