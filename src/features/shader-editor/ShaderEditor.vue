<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { EditorState, Prec } from '@codemirror/state'
import {
  EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter,
  highlightSpecialChars, drawSelection, dropCursor, rectangularSelection,
} from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab, redo, selectAll, undo } from '@codemirror/commands'
import { bracketMatching, foldGutter, foldKeymap, indentOnInput } from '@codemirror/language'
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap, snippet } from '@codemirror/autocomplete'
import { lintGutter, lintKeymap, setDiagnostics } from '@codemirror/lint'
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search'
import { glslCompletions } from '@/lib/shader/editor/glsl-completions'
import { toDiagnostics } from '@/lib/shader/editor/glsl-diagnostics'
import { glsl } from '@/lib/shader/editor/glsl-language'
import './shader-editor.css'

const props = defineProps<{ error: string | null }>()
const code = defineModel<string>({ required: true })
const emit = defineEmits<{
  compile: []
  addNode: [position: { x: number; y: number } | null]
}>()

const host = ref<HTMLDivElement>()
let view: EditorView | null = null

function applyDiagnostics(error: string | null) {
  if (!view) return
  view.dispatch(setDiagnostics(view.state, error ? toDiagnostics(view.state.doc, error) : []))
}

onMounted(() => {
  view = new EditorView({
    parent: host.value!,
    state: EditorState.create({
      doc: code.value,
      extensions: [
        Prec.highest(keymap.of([
          { key: 'Mod-Enter', run: () => (emit('compile'), true) },
          {
            key: 'Mod-Shift-a',
            run: (v) => {
              const coords = v.coordsAtPos(v.state.selection.main.head)
              emit('addNode', coords ? { x: coords.left, y: coords.bottom + 6 } : null)
              return true
            },
          },
        ])),
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightSpecialChars(),
        history(),
        foldGutter(),
        drawSelection(),
        dropCursor(),
        EditorState.allowMultipleSelections.of(true),
        indentOnInput(),
        bracketMatching(),
        closeBrackets(),
        rectangularSelection(),
        highlightActiveLine(),
        highlightSelectionMatches(),
        lintGutter(),
        glsl(),
        autocompletion({ override: [glslCompletions], icons: true, activateOnTypingDelay: 50 }),
        keymap.of([
          ...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap,
          // Cmd+Shift+M shows the Problems panel; CodeMirror's own lint panel would answer the same key
          ...foldKeymap, ...completionKeymap, ...lintKeymap.filter((binding) => binding.key !== 'Mod-Shift-m'), indentWithTab,
        ]),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) code.value = u.state.doc.toString()
        }),
      ],
    }),
  })
  applyDiagnostics(props.error)
})

watch(code, (value) => {
  if (view && value !== view.state.doc.toString()) {
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } })
  }
})

watch(() => props.error, applyDiagnostics)

function insertSnippet(template: string) {
  if (!view) return
  const { from, to } = view.state.selection.main
  snippet(template)(view, null, from, to)
  view.focus()
}

function revealLine(number: number) {
  if (!view) return
  const { from } = view.state.doc.line(Math.min(Math.max(1, number), view.state.doc.lines))
  view.dispatch({ selection: { anchor: from }, effects: EditorView.scrollIntoView(from, { y: 'center' }) })
  view.focus()
}

defineExpose({ insertSnippet, revealLine, focus: () => view?.focus(), selectAll: () => view && (view.focus(), selectAll(view)), undo: () => view && undo(view), redo: () => view && redo(view) })

onBeforeUnmount(() => view?.destroy())
</script>

<template>
  <div ref="host" class="h-full min-h-0 overflow-hidden" />
</template>
