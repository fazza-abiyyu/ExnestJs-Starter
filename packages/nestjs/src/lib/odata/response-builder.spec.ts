import { ODataResponse, odataI18n, ODataI18n } from './index.js';

describe('ODataResponse Builder', () => {
  describe('Collection Responses', () => {
    it('should build a simple collection response without optional metadata', () => {
      const items = [{ id: 1, name: 'Item 1' }];
      const result = ODataResponse.collection(items).build();

      expect(result).toEqual({
        value: items,
      });
    });

    it('should build an empty collection with count', () => {
      const result = ODataResponse.collection([])
        .context('http://api.example.com/$metadata#Products')
        .count(0)
        .build();

      expect(result).toEqual({
        '@odata.context': 'http://api.example.com/$metadata#Products',
        '@odata.count': 0,
        value: [],
      });
    });

    it('should support fluent metadata addition', () => {
      const items = [{ id: 1 }, { id: 2 }];
      const result = ODataResponse.collection(items)
        .context('http://api.example.com/$metadata#Products')
        .count(120)
        .nextLink('http://api.example.com/Products?$skip=2')
        .deltaLink('http://api.example.com/Products?$deltaToken=abc')
        .build();

      expect(result).toEqual({
        '@odata.context': 'http://api.example.com/$metadata#Products',
        '@odata.count': 120,
        '@odata.nextLink': 'http://api.example.com/Products?$skip=2',
        '@odata.deltaLink': 'http://api.example.com/Products?$deltaToken=abc',
        value: items,
      });
    });

    it('should be immutable and not modify previous builder instances', () => {
      const builder1 = ODataResponse.collection([{ id: 1 }]);
      const builder2 = builder1.context('context-url');

      expect(builder1.build()).toEqual({ value: [{ id: 1 }] });
      expect(builder2.build()).toEqual({
        '@odata.context': 'context-url',
        value: [{ id: 1 }],
      });
    });
  });

  describe('Single Resource Responses', () => {
    it('should build a single item response with metadata', () => {
      const item = { id: 1, name: 'Item 1' };
      const result = ODataResponse.item(item)
        .context('http://api.example.com/$metadata#Products/$entity')
        .etag('W/"12345"')
        .build();

      expect(result).toEqual({
        '@odata.context': 'http://api.example.com/$metadata#Products/$entity',
        '@odata.etag': 'W/"12345"',
        value: { id: 1, name: 'Item 1' },
      });
    });

    it('should support created and updated aliases', () => {
      const item = { id: 1, name: 'New Item' };
      const createdResult = ODataResponse.created(item)
        .context('http://api.example.com/$metadata#Products/$entity')
        .build();
      const updatedResult = ODataResponse.updated(item).build();

      expect(createdResult).toEqual({
        '@odata.context': 'http://api.example.com/$metadata#Products/$entity',
        value: { id: 1, name: 'New Item' },
      });
      expect(updatedResult).toEqual({
        value: { id: 1, name: 'New Item' },
      });
    });
  });

  describe('Deleted Responses', () => {
    it('should return null for deleted responses', () => {
      const result = ODataResponse.deleted();
      expect(result).toBeNull();
    });
  });

  describe('Error Responses', () => {
    it('should build a standard OData error response', () => {
      const result = ODataResponse.error('ValidationError', 'Invalid input')
        .target('name')
        .details([{ code: 'Required', message: 'Name is required', target: 'name' }])
        .innerError({ stack: 'trace' })
        .build();

      expect(result).toEqual({
        error: {
          code: 'ValidationError',
          message: 'Invalid input',
          target: 'name',
          details: [{ code: 'Required', message: 'Name is required', target: 'name' }],
          innererror: { stack: 'trace' },
        },
      });
    });

    it('should translate error messages using translate function', () => {
      const mockTranslate = (
        key: string,
        lang?: string,
        args?: { target?: string; defaultMessage?: string },
      ) => {
        if (lang === 'id') {
          if (key === 'ValidationError') return `Validasi gagal pada ${args?.target}`;
          if (key === 'Required') return 'Kolom ini wajib diisi';
        }
        return args?.defaultMessage || '';
      };

      const result = ODataResponse.error('ValidationError', 'Invalid input')
        .target('name')
        .details([{ code: 'Required', message: 'Name is required', target: 'name' }])
        .translate(mockTranslate, 'id')
        .build();

      expect(result).toEqual({
        error: {
          code: 'ValidationError',
          message: 'Validasi gagal pada name',
          target: 'name',
          details: [
            {
              code: 'Required',
              message: 'Kolom ini wajib diisi',
              target: 'name',
            },
          ],
        },
      });
    });
  });

  describe('ODataI18n Dictionary', () => {
    it('should translate registered key-value pairs', () => {
      const i18n = new ODataI18n();
      i18n.register('id', {
        ValidationError: 'Format tidak valid',
      });

      const translator = i18n.getTranslator();
      const result = ODataResponse.error('ValidationError', 'Invalid format')
        .translate(translator, 'id')
        .build();

      expect(result.error.message).toBe('Format tidak valid');
    });

    it('should fallback to defaultMessage if language or key is missing', () => {
      const i18n = new ODataI18n();
      const translator = i18n.getTranslator();
      const result = ODataResponse.error('UnknownKey', 'Fallback message')
        .translate(translator, 'en')
        .build();

      expect(result.error.message).toBe('Fallback message');
    });

    it('should support default shared instance odataI18n', () => {
      odataI18n.register('id', {
        UniqueError: 'Error unik',
      });

      const result = ODataResponse.error('UniqueError', 'Original')
        .translate(odataI18n.getTranslator(), 'id')
        .build();

      expect(result.error.message).toBe('Error unik');
    });
  });
});
