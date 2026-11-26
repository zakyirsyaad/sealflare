import { serve } from '@hono/node-server'
import { join } from 'node:path'
import { loadEnv } from './env'
import { createAnthropicClient } from './llm'
import { createPinataUploader } from './pinata'
import { createStore } from './store'
import { createBudget } from './budget'
import { createApp } from './server'

try {
  const env = loadEnv(process.env)
  const app = createApp({ env, store: createStore(env.RUN_DIR), budget: createBudget({ dailyCalls: env.DAILY_LLM_CALLS,
    file: join(env.RUN_DIR, '.budget') }),
    llm: createAnthropicClient({ apiKey: env.ANTHROPIC_API_KEY, baseURL: env.ANTHROPIC_BASE_URL }),
    upload: createPinataUploader({ jwt: env.PINATA_JWT }) })
  const server = serve({ fetch: app.fetch, hostname: '0.0.0.0', port: env.PORT })
  server.on('error', () => { console.error('Worker listener failed.'); process.exitCode = 1 })
  const stop = () => { server.close(() => process.exit(0)) }
  process.once('SIGTERM', stop)
  process.once('SIGINT', stop)
} catch (error) {
  const message = error instanceof Error && error.message.startsWith('Invalid worker environment:')
    ? error.message : 'Worker startup failed.'
  console.error(message)
  process.exitCode = 1
}
