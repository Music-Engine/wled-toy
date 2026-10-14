import {
  commandTitle,
  getCommand,
  isChecked,
  isEnabled,
  isVisible,
  menuTree,
  nativeAccelerator,
  parseAccelerator,
  type Command,
  type MenuNode,
} from '@/lib/app/commands'

export type Predefined =
  | 'Separator'
  | 'Undo'
  | 'Redo'
  | 'Cut'
  | 'Copy'
  | 'Paste'
  | 'Services'
  | 'Hide'
  | 'HideOthers'
  | 'ShowAll'
  | 'Minimize'
  | 'Maximize'
  | 'CloseWindow'

export interface NativeItem {
  type: 'item'
  id: string
  text: string
  enabled: boolean
  /** Present on a check item, also while it is off. */
  checked?: boolean
  accelerator?: string
}

export interface NativeSubmenu {
  type: 'submenu'
  text: string
  items: NativeNode[]
}

export type NativeNode = NativeItem | NativeSubmenu | { type: 'predefined'; item: Predefined }

/** `Mod+Alt+S` as muda reads it: `CmdOrCtrl+Alt+S`. */
export function toNativeAccelerator(text: string): string {
  const { mod, shift, alt, key } = parseAccelerator(text)
  return [
    ...(mod ? ['CmdOrCtrl'] : []),
    ...(alt ? ['Alt'] : []),
    ...(shift ? ['Shift'] : []),
    key.length === 1 ? key.toUpperCase() : key[0].toUpperCase() + key.slice(1),
  ].join('+')
}

const predefined = (item: Predefined): NativeNode => ({ type: 'predefined', item })

const isSeparator = (node: NativeNode | undefined) => node?.type === 'predefined' && node.item === 'Separator'

/** Items that moved to the app menu can leave a separator at an end of a menu, or two in a row. */
function withoutStraySeparators(nodes: NativeNode[]): NativeNode[] {
  const kept: NativeNode[] = []
  for (const node of nodes) if (!isSeparator(node) || (kept.length && !isSeparator(kept.at(-1)))) kept.push(node)
  if (isSeparator(kept.at(-1))) kept.pop()
  return kept
}

function nativeItem(command: Command): NativeItem {
  const accelerator = nativeAccelerator(command)
  return {
    type: 'item',
    id: command.id,
    text: commandTitle(command),
    enabled: isEnabled(command),
    ...(command.checked ? { checked: isChecked(command) } : {}),
    ...(accelerator ? { accelerator: toNativeAccelerator(accelerator) } : {}),
  }
}

/**
 * The macOS menu bar: the app menu, then the registry's menus with Edit after File and Window before Help.
 * About, Preferences and Quit sit in the app menu there, so they leave the menus the registry put them in.
 * Edit ends in a Select All of our own: the predefined item would take Cmd+A and send the webview's `selectAll:` action,
 * which raises no event a page can act on, so the graph could never select its nodes. The predefined Cut keeps Cmd+X,
 * which is what lets text fields cut in the webview; on the canvas its cut event dissolves nodes, as Cmd+X does in Blender.
 */
export function nativeMenuModel(): NativeSubmenu[] {
  const inAppMenu = ['help.about', 'app.preferences', 'app.quit']
  const convert = (nodes: MenuNode[]): NativeNode[] =>
    withoutStraySeparators(
      nodes.flatMap((node): NativeNode[] => {
        if (node.type === 'separator') return [predefined('Separator')]
        if (node.type === 'submenu') return [{ type: 'submenu', text: node.title, items: convert(node.items) }]
        return inAppMenu.includes(node.command.id) ? [] : [nativeItem(node.command)]
      }),
    )
  const [about, preferences, quit] = inAppMenu.map((id): NativeNode[] => {
    const command = getCommand(id)
    return command && isVisible(command) ? [nativeItem(command)] : []
  })
  const menus: NativeSubmenu[] = [
    {
      type: 'submenu',
      text: 'WLEDtoy',
      items: withoutStraySeparators([
        ...about,
        predefined('Separator'),
        ...preferences,
        predefined('Separator'),
        predefined('Services'),
        predefined('Separator'),
        predefined('Hide'),
        predefined('HideOthers'),
        predefined('ShowAll'),
        predefined('Separator'),
        ...quit,
      ]),
    },
  ]
  for (const menu of convert(menuTree()) as NativeSubmenu[]) {
    if (menu.text === 'Help')
      menus.push({
        type: 'submenu',
        text: 'Window',
        items: [predefined('Minimize'), predefined('Maximize'), predefined('Separator'), predefined('CloseWindow')],
      })
    menus.push(menu)
    if (menu.text === 'File') {
      menus.push({
        type: 'submenu',
        text: 'Edit',
        items: [
          { type: 'item', id: 'edit.undo', text: 'Undo', enabled: true, accelerator: 'CmdOrCtrl+Z' },
          { type: 'item', id: 'edit.redo', text: 'Redo', enabled: true, accelerator: 'CmdOrCtrl+Shift+Z' },
          predefined('Separator'),
          predefined('Cut'),
          predefined('Copy'),
          predefined('Paste'),
          { type: 'item', id: 'edit.selectAll', text: 'Select All', enabled: true, accelerator: 'CmdOrCtrl+A' },
        ],
      })
    }
  }
  return menus
}
