import type { InjectionKey } from 'vue'
import { config } from '@/lib/app/settings/config'
import { createDocumentSession, type DocumentSession } from '@/lib/documents/sessions/document-session'
import type { FileBackend } from '@/lib/documents/files/file-backends'

/** Provide a backend under this key (a native one under Tauri, a fake in tests) and the shader page uses it instead of the browser's. */
export const shaderFileBackendKey: InjectionKey<FileBackend> = Symbol('shaderFileBackend')

export const SHADER_FILE_EXTENSION = '.glsl'

/**
 * The file holds the source exactly as the user wrote it; config.code stays the working copy every edit lands in.
 * Call inside a component or an effect scope, like `createDocumentSession`.
 */
export function createShaderDocument(options: { backend: FileBackend; onLoad?: () => void }): DocumentSession<string> {
  return createDocumentSession<string>({
    mode: 'shader',
    extension: SHADER_FILE_EXTENSION,
    openExtensions: ['.frag', '.fs'],
    backend: options.backend,
    serialize: (code) => code,
    // the editor keeps \n only, so a file with Windows line ends would count as edited the moment it opened
    parse: (text) => text.replace(/\r\n?/g, '\n'),
    createNew: () => 'void mainImage(out vec4 c, vec2 uv, float ledIndex) {\n  c = vec4(rainbow(uv.x - iTime * 0.1), 1.0);\n}\n',
    getSnapshot: () => config.code,
    onLoad(code) {
      config.code = code
      options.onLoad?.()
    },
  })
}
