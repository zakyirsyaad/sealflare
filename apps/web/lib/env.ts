import 'server-only'
import { parseServerEnv } from './env.schema'
export { publicEnv } from './env.public'
// Never import this facade from client code. Use env.public there.
export const serverEnv = parseServerEnv(process.env)
