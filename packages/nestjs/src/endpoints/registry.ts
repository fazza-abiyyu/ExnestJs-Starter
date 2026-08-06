import type { EndpointConfig } from '../lib/endpoint/index.js';
import healthConfigs from './health/health.endpoint.js';
import metadataConfigs from './metadata/metadata.endpoint.js';

export const endpointRegistry: EndpointConfig[] = [...healthConfigs, ...metadataConfigs];
