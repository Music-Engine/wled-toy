import { nextTick } from 'vue'
import type { VueFlowStore } from '@vue-flow/core'

/**
 * Box selection where Shift adds to what was selected. Vue Flow clears the selection when a box starts and again
 * whenever the box touches a different set of nodes, so a Shift+drag notes what was selected before the pane sees the
 * press and puts it back.
 */
export function useBoxSelect(flow: VueFlowStore) {
  let keptSelection = new Set<string>()
  let boxSelecting = false

  function restoreKept() {
    for (const id of keptSelection) {
      const node = flow.findNode(id)
      if (node) node.selected = true
    }
  }

  flow.onSelectionStart(() => {
    boxSelecting = true
    restoreKept()
  })

  flow.onNodesChange((changes) => {
    if (boxSelecting && changes.some((change) => change.type === 'select' && !change.selected && keptSelection.has(change.id))) nextTick(restoreKept)
  })

  flow.onSelectionEnd(() => {
    boxSelecting = false
    // the box Vue Flow leaves around the selected nodes covers their fields until the next click
    flow.nodesSelectionActive.value = false
    if (keptSelection.size) selectNodes(flow, new Set([...keptSelection, ...flow.getSelectedNodes.value.map((n) => n.id)]))
    keptSelection = new Set()
  })

  return {
    /** Bound to the capture phase, so it runs before the pane starts the box. */
    noteSelection(e: PointerEvent) {
      keptSelection = new Set(e.shiftKey && e.button === 0 ? flow.getSelectedNodes.value.map((n) => n.id) : [])
    },
  }
}

/** Selects exactly these nodes and, as a box selection does, every link that touches one of them. */
export function selectNodes(flow: VueFlowStore, ids: Set<string>) {
  flow.addSelectedElements([
    ...flow.getNodes.value.filter((n) => ids.has(n.id)),
    ...flow.edges.value.filter((e) => ids.has(e.source) || ids.has(e.target)),
  ])
}
