import { reactive, ref, watch } from 'vue'

export type DockId = 'right' | 'bottom'
export type Mode = 'shader' | 'graph' | 'reference'
/** What the preview pane shows for a device with a layout: the shader with the LEDs marked on it, or the LEDs alone, lit, where the layout puts them. */
export type PreviewView = 'render' | 'leds'

export interface Problem {
  message: string
  nodeId?: string | null
  location?: string
  /** 1-based line of the shader source, when the problem has one. */
  line?: number
}

/** The row under the problems list's context menu; the registry's problems.* commands read and act on it. */
export const contextProblem = ref<Problem | null>(null)

interface DockTab {
  id: string
  label: string
  home: DockId
  modes: readonly Mode[]
}

export const DOCK_TABS = [
  { id: 'parameters', label: 'Parameters', home: 'right', modes: ['graph'] },
  { id: 'output', label: 'Output', home: 'right', modes: ['shader', 'graph', 'reference'] },
  { id: 'inputs', label: 'Inputs', home: 'right', modes: ['shader', 'graph', 'reference'] },
  { id: 'problems', label: 'Problems', home: 'bottom', modes: ['shader', 'graph'] },
  { id: 'log', label: 'Log', home: 'bottom', modes: ['shader', 'graph', 'reference'] },
  { id: 'glsl', label: 'GLSL', home: 'bottom', modes: ['graph'] },
  { id: 'performance', label: 'Performance', home: 'bottom', modes: ['shader', 'graph', 'reference'] },
] as const satisfies readonly DockTab[]

export type TabId = (typeof DOCK_TABS)[number]['id']

export const DOCK_SIZES = {
  right: { min: 300, max: 560, initial: 360 },
  // the bottom panel's real ceiling is 60% of the editor column, which only the shell can measure
  bottom: { min: 120, max: Infinity, initial: 220 },
}

interface Layout {
  dockWidth: number
  dockVisible: boolean
  bottomHeight: number
  bottomVisible: boolean
  stripVisible: boolean
  placement: Record<TabId, DockId>
  activeTab: Record<DockId, Partial<Record<Mode, TabId>>>
  previewView: PreviewView
}

// its own key, not AppConfig: exportConfig would carry panel sizes into a show file, and the config storage listener would make two windows fight over layout
const STORAGE_KEY = 'wledtoy:workspace'

const defaults = (): Layout => ({
  dockWidth: DOCK_SIZES.right.initial,
  dockVisible: true,
  bottomHeight: DOCK_SIZES.bottom.initial,
  bottomVisible: false,
  stripVisible: true,
  placement: Object.fromEntries(DOCK_TABS.map((tab) => [tab.id, tab.home])) as Record<TabId, DockId>,
  activeTab: { right: {}, bottom: {} },
  previewView: 'render',
})

const isDock = (value: unknown): value is DockId => value === 'right' || value === 'bottom'
const isTab = (value: unknown): value is TabId => DOCK_TABS.some((tab) => tab.id === value)
const record = (value: unknown) => (value && typeof value === 'object' ? (value as Record<string, unknown>) : {})

/** Keeps what is valid in a stored layout and falls back to the default for the rest. */
export function sanitize(raw: unknown): Layout {
  const src = record(raw)
  const out = defaults()
  const size = (value: unknown, { min, max, initial }: { min: number; max: number; initial: number }) =>
    (typeof value === 'number' && Number.isFinite(value) ? Math.round(Math.min(max, Math.max(min, value))) : initial)
  out.dockWidth = size(src.dockWidth, DOCK_SIZES.right)
  out.bottomHeight = size(src.bottomHeight, DOCK_SIZES.bottom)
  if (typeof src.dockVisible === 'boolean') out.dockVisible = src.dockVisible
  if (typeof src.bottomVisible === 'boolean') out.bottomVisible = src.bottomVisible
  if (typeof src.stripVisible === 'boolean') out.stripVisible = src.stripVisible
  if (src.previewView === 'render' || src.previewView === 'leds') out.previewView = src.previewView
  for (const [id, dock] of Object.entries(record(src.placement))) {
    if (isTab(id) && isDock(dock)) out.placement[id] = dock
  }
  for (const dock of ['right', 'bottom'] as const) {
    for (const [mode, id] of Object.entries(record(record(src.activeTab)[dock]))) {
      if ((mode === 'shader' || mode === 'graph' || mode === 'reference') && isTab(id)) out.activeTab[dock][mode] = id
    }
  }
  return out
}

function load(): Layout {
  try {
    return sanitize(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}'))
  } catch {
    return defaults()
  }
}

/** `mode` and `problemCount` are runtime only: the shell sets the mode, the active page's ProblemsList the count. */
export const workspace = reactive({ ...load(), mode: 'shader' as Mode, problemCount: 0 })

watch(() => {
  const { mode, problemCount, ...layout } = workspace
  return JSON.stringify(layout)
}, (serialized) => localStorage.setItem(STORAGE_KEY, serialized))

export function resetLayout() {
  Object.assign(workspace, defaults())
}

/** The tabs a dock shows in the current mode, in `DOCK_TABS` order. */
export const visibleTabs = (dock: DockId) =>
  DOCK_TABS.filter((tab) => workspace.placement[tab.id] === dock && (tab.modes as readonly Mode[]).includes(workspace.mode))

/** The remembered tab of a dock for the current mode, or its first tab when that one is not showing. */
export function activeTab(dock: DockId): TabId | null {
  const tabs = visibleTabs(dock)
  const stored = workspace.activeTab[dock][workspace.mode]
  return tabs.some((tab) => tab.id === stored) ? stored! : tabs[0]?.id ?? null
}

export function selectTab(id: TabId) {
  workspace.activeTab[workspace.placement[id]][workspace.mode] = id
}

/** Selects the tab and opens the dock it lives in. */
export function showTab(id: TabId) {
  selectTab(id)
  if (workspace.placement[id] === 'right') workspace.dockVisible = true
  else workspace.bottomVisible = true
}

export function moveTab(id: TabId, dock: DockId) {
  workspace.placement[id] = dock
  showTab(id)
}

const hosts = new Map<string, HTMLElement>()

/**
 * The element a tab's content is teleported into, one per tab for the life of the page. DockTabs adopts it into
 * whichever dock the tab is placed in, so moving a tab moves live DOM and the content keeps its state.
 * The `actions` part is the same for the buttons a panel puts at the right of the tab strip while its tab is selected.
 */
export function dockHost(id: TabId, part: 'body' | 'actions' = 'body'): HTMLElement {
  const key = part === 'body' ? `dock-tab-${id}` : `dock-tab-${id}-actions`
  let host = hosts.get(key)
  if (!host) {
    host = document.createElement('div')
    host.id = key
    // a panel that scrolls itself (the log) needs a height to fill; taller content still overflows into the dock body's scroll
    host.className = part === 'body' ? 'h-full' : 'flex items-center gap-1'
    hosts.set(key, host)
  }
  return host
}
