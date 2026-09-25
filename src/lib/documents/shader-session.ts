import { watch } from 'vue'

/**
 * When the shader being edited reaches the target: at once when shown or asked, otherwise once typing pauses for
 * 700 ms. Nothing is compiled while hidden. Call `start` and `stop` as the editor is shown and hidden.
 */
export function createShaderSession({ code, target }: ShaderSessionOptions) {
  let active = false
  let timer: ReturnType<typeof setTimeout> | undefined

  function compile() {
    clearTimeout(timer)
    target.compile(code())
  }

  watch(code, () => {
    if (!active) return
    clearTimeout(timer)
    timer = setTimeout(compile, 700)
  })

  return {
    compile,
    /** A new, opened, reverted or recovered shader shows at once instead of after the typing pause. */
    compileIfShown() {
      if (active) compile()
    },
    start() {
      active = true
      compile()
    },
    stop() {
      active = false
      clearTimeout(timer)
    },
  }
}

export type ShaderEditSession = ReturnType<typeof createShaderSession>

export interface ShaderSessionOptions {
  code: () => string
  /** The engine in the app, kept out of this module so the timing rules test without one. */
  target: { compile(code: string): void }
}
