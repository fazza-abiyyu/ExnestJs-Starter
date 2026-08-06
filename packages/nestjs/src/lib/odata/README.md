# 📊 OData V4 Response Builder

Standardized collection and single resource payload formatter for OData V4 compliance.

---

## Responsibility

Formats response objects to comply with the OData V4 protocol specification. This module is decoupled from any HTTP frameworks and works with raw JavaScript objects.

---

## API Reference

### Collections

Generates OData V4 collection wrapper with metadata.

```typescript
import { ODataResponse } from './index';

const response = ODataResponse.collection([{ id: 1, name: 'Product A' }])
  .context('https://api.example.com/$metadata#Products')
  .count(120)
  .nextLink('https://api.example.com/Products?$skip=1')
  .build();
```

Output:
```json
{
  "@odata.context": "https://api.example.com/$metadata#Products",
  "@odata.count": 120,
  "@odata.nextLink": "https://api.example.com/Products?$skip=1",
  "value": [
    { "id": 1, "name": "Product A" }
  ]
}
```

### Single Resources

Generates OData V4 single resource payload.

```typescript
const response = ODataResponse.item({ id: 1, name: 'Product A' })
  .context('https://api.example.com/$metadata#Products/$entity')
  .etag('W/"12345"')
  .build();
```

Output:
```json
{
  "@odata.context": "https://api.example.com/$metadata#Products/$entity",
  "@odata.etag": "W/\"12345\"",
  "id": 1,
  "name": "Product A"
}
```

### Errors

Generates OData V4 error payload.

```typescript
const response = ODataResponse.error('ValidationError', 'Invalid input')
  .target('price')
  .details([{ code: 'RangeError', message: 'Price must be greater than zero', target: 'price' }])
  .build();
```

Output:
```json
{
  "error": {
    "code": "ValidationError",
    "message": "Invalid input",
    "target": "price",
    "details": [
      {
        "code": "RangeError",
        "message": "Price must be greater than zero",
        "target": "price"
      }
    ]
  }
}
```

### Localization (i18n)

Applies a custom translator callback to translate error and detail messages.

```typescript
const translator = (key: string, lang?: string, args?: any) => {
  if (lang === 'id' && key === 'ValidationError') {
    return 'Validasi gagal';
  }
  return args?.defaultMessage || '';
};

const response = ODataResponse.error('ValidationError', 'Invalid input')
  .translate(translator, 'id')
  .build();
```

Alternatively, use the built-in dictionary helper `odataI18n` to register key-value translations:

```typescript
import { ODataResponse, odataI18n } from './index';

// Register translations for a language
odataI18n.register('id', {
  ValidationError: 'Format data tidak valid',
  RequiredField: 'Kolom ini wajib diisi'
});

// Translate errors using the registered dictionary
const response = ODataResponse.error('ValidationError', 'Invalid input')
  .translate(odataI18n.getTranslator(), 'id')
  .build();
```


