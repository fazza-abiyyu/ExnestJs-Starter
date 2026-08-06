import { odataI18n } from '../../lib/odata/index.js'

export function registerCustomersTranslations(): void {
  odataI18n.register('id', {
    CustomerNotFound: 'Customer tidak ditemukan',
    CustomerDuplicate: 'Customer sudah ada',
    CustomerCreated: 'Customer berhasil dibuat',
    CustomerUpdated: 'Customer berhasil diperbarui',
    CustomerArchived: 'Customer berhasil diarsipkan',
  })

  odataI18n.register('en', {
    CustomerNotFound: 'Customer not found',
    CustomerDuplicate: 'Customer already exists',
    CustomerCreated: 'Customer created successfully',
    CustomerUpdated: 'Customer updated successfully',
    CustomerArchived: 'Customer archived successfully',
  })
}