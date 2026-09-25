import type { Ref } from 'vue'
import type { VueFlowStore } from '@vue-flow/core'
import { duplicateSelection } from '@/features/graph-editor/clipboard/use-node-clipboard'
import type { GraphEditSession } from '@/lib/documents/graph-session'
import { invertSelection, linkSelected, selectLinked, toggleMute, toggleShared } from './node-edits'

interface NodeCommandTargets {
  flow: VueFlowStore
  session: GraphEditSession
  grab: { start: () => void }
  /** The node whose title is being edited. */
  renaming: Ref<string | null>
  findOpen: Ref<boolean>
}

/** The handlers of Blender's node editor keys, for the graph editor's command scope. */
export function nodeCommands({ flow, session, grab, renaming, findOpen }: NodeCommandTargets): Record<string, () => unknown> {
  return {
    'graph.duplicate': async () => { if (await duplicateSelection(flow, session)) grab.start() },
    'graph.grab': grab.start,
    'graph.toggleCollapse': () => toggleShared(flow, 'collapsed'),
    'graph.hideUnusedSockets': () => toggleShared(flow, 'hideUnused'),
    'graph.mute': () => toggleMute(flow),
    'graph.linkSelected': () => linkSelected(flow),
    'graph.invertSelection': () => invertSelection(flow),
    'graph.selectLinkedFrom': () => selectLinked(flow, 'from'),
    'graph.selectLinkedTo': () => selectLinked(flow, 'to'),
    'graph.viewSelected': () => {
      const nodes = flow.getSelectedNodes.value.map((n) => n.id)
      if (nodes.length) flow.fitView({ nodes, padding: 0.2, maxZoom: 1.2, duration: 300 })
    },
    'graph.rename': () => { renaming.value = flow.getSelectedNodes.value[0]?.id ?? null },
    'graph.findNode': () => { findOpen.value = true },
  }
}
