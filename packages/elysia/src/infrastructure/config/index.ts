import { readFileSync } from 'fs'
import { resolve } from 'path'
import { z } from 'zod'

let packageName = 'unnamed'
try {
  const pkg = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf-8'))
  packageName = pkg.name ?? 'unnamed'
} catch {
  // fallback
}

const normalizedName = packageName.replace(/[^a-zA-Z0-9_-]/g, '')

const envSchema = z.object({
  APP_NAME: z.string().default(packageName),
  DATABASE_URL: z
    .string()
    .url()
    .default(`postgresql://localhost:5432/${normalizedName}`),
  PORT: z.coerce.number().default(3000),
  API_BASE_URL: z.string().url().default('http://localhost:3000'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  JWT_SECRET: z.string().default('super-secret-key-change-in-production'),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().email().default(`noreply@${normalizedName}.dev`),
})

export type Env = z.infer<typeof envSchema>

const parsed = envSchema.parse(process.env)

export const config = {
  env: parsed,
  appName: parsed.APP_NAME,
  port: parsed.PORT,
  apiBaseUrl: parsed.API_BASE_URL,
  databaseUrl: parsed.DATABASE_URL,
  nodeEnv: parsed.NODE_ENV,
}