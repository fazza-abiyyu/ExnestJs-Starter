import { createApp } from './app.js'
import { config } from './infrastructure/config/index.js'

const app = createApp().listen(config.port)

console.log(
  `🦊 ${config.appName} is running at ${app.server?.hostname}:${app.server?.port}`,
)
