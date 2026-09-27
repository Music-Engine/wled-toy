// every surface that reads the registry expects the app's own commands in it, so importing it registers them
import './app-commands'

export * from './registry'
export * from './accelerators'
export { isMac } from '@/lib/app/platform'
