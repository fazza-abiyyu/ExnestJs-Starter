import { parseODataQuery } from './query.js';

describe('OData Query Parser', () => {
  it('should parse pagination parameters ($top and $skip)', () => {
    const query = { $top: '10', $skip: '20' };
    const parsed = parseODataQuery(query);

    expect(parsed.take).toBe(10);
    expect(parsed.skip).toBe(20);
  });

  it('should ignore non-numeric $top and $skip', () => {
    const query = { $top: 'invalid', $skip: 'abc' };
    const parsed = parseODataQuery(query);

    expect(parsed.take).toBeUndefined();
    expect(parsed.skip).toBeUndefined();
  });

  it('should parse single sorting field ($orderby)', () => {
    const query = { $orderby: 'createdAt desc' };
    const parsed = parseODataQuery(query);

    expect(parsed.orderBy).toEqual({ createdAt: 'desc' });
  });

  it('should parse multiple sorting fields ($orderby)', () => {
    const query = { $orderby: 'createdAt desc, name asc' };
    const parsed = parseODataQuery(query);

    expect(parsed.orderBy).toEqual([
      { createdAt: 'desc' },
      { name: 'asc' },
    ]);
  });

  it('should default sorting direction to asc if direction is missing', () => {
    const query = { $orderby: 'name' };
    const parsed = parseODataQuery(query);

    expect(parsed.orderBy).toEqual({ name: 'asc' });
  });

  it('should parse select fields ($select)', () => {
    const query = { $select: 'id,name,email' };
    const parsed = parseODataQuery(query);

    expect(parsed.select).toEqual({
      id: true,
      name: true,
      email: true,
    });
  });

  it('should return empty object if query is empty', () => {
    const parsed = parseODataQuery({});
    expect(parsed).toEqual({});
  });
});

