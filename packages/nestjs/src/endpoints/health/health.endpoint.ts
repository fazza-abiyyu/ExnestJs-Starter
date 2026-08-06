import type { EndpointConfig } from '../../lib/endpoint/index.js';
import { HealthController } from '../../modules/health/index.js';

export const healthLiveConfig: EndpointConfig = {
  method: 'GET',
  path: '/health/live',
  controller: HealthController,
  handler: 'live',
  tags: ['System'],
  responses: [{ status: 200, description: 'Process alive' }],
};

export const healthReadyConfig: EndpointConfig = {
  method: 'GET',
  path: '/health/ready',
  controller: HealthController,
  handler: 'ready',
  tags: ['System'],
  responses: [
    { status: 200, description: 'Service ready' },
    { status: 503, description: 'Service unavailable' },
  ],
};

const healthConfigs: EndpointConfig[] = [healthLiveConfig, healthReadyConfig];
export default healthConfigs;
