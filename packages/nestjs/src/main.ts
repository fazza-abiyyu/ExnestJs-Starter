import 'dotenv/config';
import express from 'express';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { mountEndpoints } from './endpoints/index.js';
import { requestLogger } from './middleware/request-logger.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableCors({
    origin: true,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'PUT', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Correlation-Id',
    ],
  });
  app.use(express.json());
  app.use(compression());
  app.use(cookieParser());
  app.use(requestLogger());
  app.use(mountEndpoints(app));

  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
