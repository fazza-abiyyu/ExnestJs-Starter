// OData entity type metadata

import { Injectable } from '@nestjs/common';
import { ConfigService } from './../../infrastructure/config/config.service.js';
import type { MetadataResponse, MetadataEntityType } from './metadata.interface.js';

@Injectable()
export class MetadataService {
  constructor(private readonly config: ConfigService) {}

  getEntityTypes(): MetadataEntityType[] {
    return [
      {
        name: 'Health',
        fragment: 'Health',
        description: 'System health check result',
        properties: [
          { name: 'status', type: 'Edm.String' },
          { name: 'uptime', type: 'Edm.Double' },
          { name: 'timestamp', type: 'Edm.DateTimeOffset' },
          { name: 'details', type: 'HealthDetails' },
        ],
      },
      {
        name: 'HealthDetails',
        fragment: 'HealthDetails',
        properties: [
          { name: 'system', type: 'SystemHealth' },
          { name: 'database', type: 'DatabaseHealth' },
        ],
      },
      {
        name: 'SystemHealth',
        fragment: 'SystemHealth',
        properties: [
          { name: 'status', type: 'Edm.String' },
          { name: 'memoryUsage', type: 'Edm.Object' },
        ],
      },
      {
        name: 'DatabaseHealth',
        fragment: 'DatabaseHealth',
        properties: [
          { name: 'status', type: 'Edm.String' },
          { name: 'message', type: 'Edm.String', nullable: true },
        ],
      },
      {
        name: 'User',
        fragment: 'User',
        description: 'Authenticated user profile',
        properties: [
          { name: 'id', type: 'Edm.String' },
          { name: 'email', type: 'Edm.String' },
          { name: 'displayName', type: 'Edm.String' },
          { name: 'avatarUrl', type: 'Edm.String', nullable: true },
          { name: 'locale', type: 'Edm.String', nullable: true },
          { name: 'timeZone', type: 'Edm.String', nullable: true },
          { name: 'status', type: 'Edm.String' },
          { name: 'createdAt', type: 'Edm.DateTimeOffset' },
        ],
      },
      {
        name: 'Auth.Register',
        fragment: 'Auth.Register',
        description: 'User registration response',
        properties: [
          { name: 'accessToken', type: 'Edm.String' },
          { name: 'user', type: 'User' },
        ],
      },
      {
        name: 'Auth.Login',
        fragment: 'Auth.Login',
        description: 'User login response',
        properties: [
          { name: 'accessToken', type: 'Edm.String' },
          { name: 'user', type: 'User' },
        ],
      },
      {
        name: 'Auth.Refresh',
        fragment: 'Auth.Refresh',
        description: 'Token refresh response',
        properties: [
          { name: 'accessToken', type: 'Edm.String' },
          { name: 'user', type: 'User' },
        ],
      },
      {
        name: 'Auth.Logout',
        fragment: 'Auth.Logout',
        description: 'Logout response',
        properties: [{ name: 'message', type: 'Edm.String' }],
      },
    ];
  }

  getMetadata(): MetadataResponse & { '@odata.context': string } {
    return {
      '@odata.context': `${this.config.apiBaseUrl}/$metadata`,
      entityTypes: this.getEntityTypes(),
    };
  }

  getEntityTypeByFragment(fragment: string): MetadataEntityType | undefined {
    return this.getEntityTypes().find((t) => t.fragment === fragment);
  }
}
