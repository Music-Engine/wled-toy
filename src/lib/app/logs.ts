import { computed, ref } from 'vue'
import { AppError } from './app-error'
import { copyText } from '@/lib/app/files/clipboard'
import { preferences } from '@/lib/app/settings/preferences'

export type LogLevel = 'info' | 'warn' | 'error'

export interface LogEntry {
  id: number
  time: Date
  level: LogLevel
  message: string
}

let nextId = 0

export const logs = ref<LogEntry[]>([])

export function log(message: string, level: LogLevel = 'info') {
  logs.value.push({ id: nextId++, time: new Date(), level, message })
  if (logs.value.length > preferences.logLines) logs.value.splice(0, logs.value.length - preferences.logLines)
}

// an object without a prototype has no toString, and a hostile one can throw from it; report must not
function describe(value: unknown): string {
  try {
    return String(value)
  } catch {
    return Object.prototype.toString.call(value)
  }
}

/**
 * Where every caught failure goes: one error line with the context, the message, the module and code of a coded error,
 * and the message of its cause. A thrown value that is not an Error is wrapped in an AppError. Never throws.
 */
export function report(error: unknown, context?: string) {
  const failure = error instanceof Error ? error : new AppError('thrown-value', describe(error))
  const code = (failure as { code?: unknown }).code
  const tag = typeof code === 'string' ? ` [${failure.name.replace(/Error$/, '').toLowerCase()} ${code}]` : ''
  const cause = failure.cause === undefined ? '' : ` (cause: ${failure.cause instanceof Error ? failure.cause.message : describe(failure.cause)})`
  log(`${context ? `${context}: ` : ''}${failure.message}${tag}${cause}`, 'error')
}

export function clearLogs() {
  logs.value = []
}

// the log panel is a single shell-owned instance (App.vue), so its filter and context row live here
// where the registry's log.* commands can read and act on them from outside the component
export const logFilter = ref<'all' | 'warn' | 'error'>('all')
export const logContext = ref<LogEntry | null>(null)
export const shownLogs = computed(() => logs.value.filter((entry) => logFilter.value === 'all' || entry.level === 'error' || (logFilter.value === 'warn' && entry.level === 'warn')))

export const logTimeFormat = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
const formatLogEntry = (entry: LogEntry) => `${logTimeFormat.format(entry.time)} ${entry.level} ${entry.message}`

export function copyLogLine() {
  if (logContext.value) return copyText(formatLogEntry(logContext.value))
}

export function copyAllLogs() {
  return copyText(shownLogs.value.map(formatLogEntry).join('\n'))
}
