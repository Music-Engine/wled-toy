import { onActivated, onBeforeUnmount, onDeactivated, reactive, type Ref } from 'vue'
import { config } from '@/lib/app/config'
import { log } from '@/lib/app/logs'
import { createShaderSession } from '@/lib/documents/shader-session'
import { useEngine } from '@/lib/engine/engine'
import { EXAMPLES, type ShaderExample } from '@/lib/shader/examples'
import type { ShaderNode } from '@/lib/shader/glsl'
import type ShaderEditor from './ShaderEditor.vue'

/** The shader page's compile schedule, its examples menu and its add-node menu, bound to the page's lifecycle. */
export function useShaderSession(editor: Ref<InstanceType<typeof ShaderEditor> | undefined>) {
  const engine = useEngine()
  const session = createShaderSession({ code: () => config.code, target: { compile: (code) => engine.compile(code, 'shader') } })
  const nodeMenu = reactive({ open: false, position: null as { x: number; y: number } | null })

  onActivated(session.start)
  onDeactivated(session.stop)
  onBeforeUnmount(session.stop)

  function loadExample(example: ShaderExample) {
    config.code = example.code
    session.compile()
    log(`Loaded example: ${example.name} (Cmd+Z in the editor restores your previous shader)`)
  }

  const exampleItems = EXAMPLES.map((example) => ({
    label: example.name,
    description: example.description,
    icon: example.icon,
    onSelect: () => loadExample(example),
  }))

  function openNodeMenu(position: { x: number; y: number } | null) {
    nodeMenu.position = position
    nodeMenu.open = true
  }

  function insertNode(node: ShaderNode) {
    editor.value?.insertSnippet(node.snippet)
    log(`Added node: ${node.title}`)
  }

  return { compile: session.compile, compileIfShown: session.compileIfShown, exampleItems, nodeMenu, openNodeMenu, insertNode }
}
