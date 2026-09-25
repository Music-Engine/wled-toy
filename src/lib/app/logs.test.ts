import { beforeEach, describe, expect, it } from 'vitest'
import { AppError } from './app-error'
import { clearLogs, logs, report } from './logs'
import { DocumentError } from '@/lib/documents/document-error'
import { NativeError } from '@/lib/native/native-error'
import { BridgeError } from '@/lib/bridge/bridge-error'
import { EngineError } from '@/lib/engine/engine-error'

beforeEach(clearLogs)

const lines = () => logs.value.map((entry) => `${entry.level}: ${entry.message}`)

describe('module errors', () => {
  it.each([
    ['AppError', new AppError('storage-reset', 'reset', 'bad json')],
    ['DocumentError', new DocumentError('file-gone', 'gone', 'bad json')],
    ['NativeError', new NativeError('menu-sync', 'no menu', 'bad json')],
    ['BridgeError', new BridgeError('link-failed', 'no link', 'bad json')],
    ['EngineError', new EngineError('media-store', 'no store', 'bad json')],
  ])('%s is an Error with its name, code and cause', (name, error) => {
    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe(name)
    expect(error.code).toMatch(/^[a-z-]+$/)
    expect(error.cause).toBe('bad json')
    expect(String(error)).toBe(`${name}: ${error.message}`)
  })
})

describe('report', () => {
  it('logs one error line per call, in order: context, message, module and code, then the cause', () => {
    report(new DocumentError('file-gone', 'a.wledgraph can no longer be opened', new Error('ENOENT')), 'Open Recent failed')
    report(new EngineError('media-store', 'Your song could not be loaded'))
    report(new Error('plain'), 'Export failed')
    expect(lines()).toEqual([
      'error: Open Recent failed: a.wledgraph can no longer be opened [document file-gone] (cause: ENOENT)',
      'error: Your song could not be loaded [engine media-store]',
      'error: Export failed: plain',
    ])
  })

  it('wraps a thrown value that is not an Error, and never throws on one that cannot be printed', () => {
    report('permission denied', 'Desktop shell')
    report(Object.create(null))
    expect(lines()).toEqual([
      'error: Desktop shell: permission denied [app thrown-value]',
      'error: [object Object] [app thrown-value]',
    ])
  })
})
