import { odataI18n } from '../../lib/odata/index.js';

export function registerMetadataTranslations(): void {
  odataI18n.register('id', {
    EntityTypeNotFound: 'Tipe entitas tidak ditemukan',
  });

  odataI18n.register('en', {
    EntityTypeNotFound: 'Entity type not found',
  });
}
