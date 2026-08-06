export interface ODataQueryOptions<T> {
  $filter?: string
  $orderby?: string
  $top?: number | string
  $skip?: number | string
  $select?: string
  $expand?: string
  $count?: boolean | string
}

export interface ODataPrismaQuery {
  take?: number
  skip?: number
  orderBy?: Record<string, 'asc' | 'desc'> | Record<string, 'asc' | 'desc'>[]
  select?: Record<string, boolean>
}

export function parseODataQuery<T>(query: Record<string, any>): ODataPrismaQuery {
  const prismaQuery: ODataPrismaQuery = {}

  if (query.$top !== undefined) {
    const top = parseInt(String(query.$top), 10)
    if (!isNaN(top)) {
      prismaQuery.take = top
    }
  }

  if (query.$skip !== undefined) {
    const skip = parseInt(String(query.$skip), 10)
    if (!isNaN(skip)) {
      prismaQuery.skip = skip
    }
  }

  if (query.$orderby) {
    const orderParts = String(query.$orderby).split(',')
    const orderByList: Record<string, 'asc' | 'desc'>[] = []

    for (const part of orderParts) {
      const [field, direction] = part.trim().split(/\s+/)
      if (field) {
        const dir = direction?.toLowerCase() === 'desc' ? 'desc' : 'asc'
        orderByList.push({ [field]: dir })
      }
    }

    if (orderByList.length > 0) {
      prismaQuery.orderBy = orderByList.length === 1 ? orderByList[0] : orderByList
    }
  }

  if (query.$select) {
    const selectFields = String(query.$select).split(',')
    const selectObj: Record<string, boolean> = {}

    for (const field of selectFields) {
      const trimmed = field.trim()
      if (trimmed) {
        selectObj[trimmed] = true
      }
    }

    if (Object.keys(selectObj).length > 0) {
      prismaQuery.select = selectObj
    }
  }

  return prismaQuery
}