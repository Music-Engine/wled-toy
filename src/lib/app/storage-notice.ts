import { AppError } from './app-error'
import { report } from './logs'
import { onStorageFailure } from './storage'

/** Tells the user, once per key, that what was stored under it was unreadable and is back to its defaults. */
export function installStorageNotice() {
  const reported = new Set<string>()
  onStorageFailure(({ key, name, cause }) => {
    if (reported.has(key)) return
    reported.add(key)
    report(new AppError('storage-reset', `${name[0].toUpperCase()}${name.slice(1)} could not be read and were reset to the defaults`, cause))
  })
}
