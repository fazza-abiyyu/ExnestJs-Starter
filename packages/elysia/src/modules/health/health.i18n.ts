import { odataI18n } from '../../lib/odata/index.js';

export function registerHealthTranslations(): void {
  odataI18n.register('id', {
    DatabaseOffline: 'Koneksi database terputus',
  });

  odataI18n.register('en', {
    DatabaseOffline: 'Database connection is offline',
  });
}
