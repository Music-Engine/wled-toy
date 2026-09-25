import { useColorMode } from '@vueuse/core'
import { systemAudioBlocked } from '@/lib/audio/service'
import { copyText } from './clipboard'
import { config, exportConfig } from './config'
import { activeDeviceId, devices, setActiveDevice } from './devices'
import { useEngine } from '@/lib/engine/engine'
import { isStripLayout } from '@/lib/engine/layout'
import { EXAMPLES } from '@/lib/shader/examples'
import { chooseConfig, chooseImage, chooseSong } from './file-choosers'
import { clearLogs, copyAllLogs, copyLogLine, log, logContext, shownLogs } from './logs'
import { isMac, isTauri } from './platform'
import { palette, registerCommands, type Command } from './registry'
import { contextProblem, DOCK_TABS, isMaximized, resetLayout, showTab, toggleMaximize, workspace } from './workspace'

let colorMode: ReturnType<typeof useColorMode> | undefined
const theme = () => (colorMode ??= useColorMode()).store

const themeCommand = (value: 'light' | 'dark' | 'auto', title: string, accelerator: string): Command => ({
  id: `view.theme.${value}`,
  title,
  menu: ['View', 'Theme'],
  group: 'appearance',
  accelerator,
  checked: () => theme().value === value,
  run: () => { theme().value = value },
})

const audioSource = () => useEngine().audio.state.settings.source

registerCommands([
  { id: 'file.new', title: () => (workspace.mode === 'shader' ? 'New Shader' : 'New Graph'), menu: ['File'], group: 'document', accelerator: 'Mod+N' },
  { id: 'file.open', title: 'Open...', menu: ['File'], group: 'document', accelerator: 'Mod+O' },
  { id: 'file.openRecent', title: 'Open Recent', menu: ['File'], group: 'document', accelerator: 'Mod+Shift+O' },
  { id: 'file.save', title: 'Save', menu: ['File'], group: 'document', accelerator: 'Mod+S' },
  { id: 'file.saveAs', title: 'Save As...', menu: ['File'], group: 'document', accelerator: 'Mod+Shift+S' },
  { id: 'file.revert', title: 'Revert', menu: ['File'], group: 'document', accelerator: 'Mod+Alt+R' },
  // imported on use: the bundler pulls in the graph compiler, which nothing else in the registry needs
  { id: 'file.exportGlsl', title: 'Standalone GLSL...', menu: ['File', 'Export'], group: 'document', accelerator: 'Mod+Alt+E', modes: ['shader', 'graph'], run: async () => (await import('@/lib/shader/shader-export')).exportStandaloneGlsl() },
  {
    id: 'shader.examples',
    list: () => EXAMPLES.map((example) => ({
      id: `shader.example.${example.name}`,
      title: example.name,
      menu: ['File', 'Load Example'],
      group: 'document',
      modes: ['shader'],
      // the shader page compiles whatever lands in config.code
      run: () => {
        config.code = example.code
        log(`Loaded example: ${example.name} (Cmd+Z in the editor restores your previous shader)`)
      },
    })),
  },

  { id: 'audio.fromFile', title: 'From File...', menu: ['File', 'Set Audio'], group: 'media', accelerator: 'Mod+Alt+U', checked: () => audioSource() === 'file' && useEngine().audio.state.fileName !== 'Built-in track', run: chooseSong },
  {
    id: 'audio.builtIn',
    title: 'Use Built-in Track',
    menu: ['File', 'Set Audio'],
    group: 'media',
    accelerator: 'Mod+Alt+Shift+U',
    checked: () => audioSource() === 'file' && useEngine().audio.state.fileName === 'Built-in track',
    run: async () => {
      await useEngine().useSong(null)
      await useEngine().audio.configure({ source: 'file' })
    },
  },
  { id: 'audio.microphone', title: 'Microphone', menu: ['File', 'Set Audio'], group: 'capture', accelerator: 'Mod+Alt+Y', checked: () => audioSource() === 'device', run: () => useEngine().audio.configure({ source: 'device' }) },
  {
    id: 'audio.system',
    title: () => (systemAudioBlocked() ? 'System Audio (not available in the desktop app)' : 'System Audio'),
    menu: ['File', 'Set Audio'],
    group: 'capture',
    accelerator: 'Mod+Alt+Shift+Y',
    enabled: () => !systemAudioBlocked(),
    checked: () => audioSource() === 'loopback',
    run: () => useEngine().audio.configure({ source: 'loopback' }),
  },
  { id: 'image.fromFile', title: 'From File...', menu: ['File', 'Set Image'], group: 'media', accelerator: 'Mod+Alt+P', checked: () => useEngine().imageName.value !== 'Built-in image', run: chooseImage },
  { id: 'image.builtIn', title: 'Use Built-in Image', menu: ['File', 'Set Image'], group: 'media', accelerator: 'Mod+Alt+Shift+P', checked: () => useEngine().imageName.value === 'Built-in image', run: () => useEngine().useImage(null) },

  { id: 'config.import', title: 'Import Config...', menu: ['File'], group: 'config', accelerator: 'Mod+Alt+O', run: chooseConfig },
  { id: 'config.export', title: 'Export Config...', menu: ['File'], group: 'config', accelerator: 'Mod+Alt+S', run: async () => { if (await exportConfig()) log('Config exported') } },
  { id: 'app.preferences', title: 'Preferences...', menu: ['File'], group: 'preferences', accelerator: 'Mod+,' },
  {
    id: 'app.quit',
    title: 'Quit WLEDtoy',
    menu: ['File'],
    group: 'quit',
    accelerator: 'Mod+Q',
    when: isTauri,
    // closing the window, not ending the process: the close request is where unsaved work gets asked about
    run: async () => (await import('@tauri-apps/api/window')).getCurrentWindow().close(),
  },

  { id: 'mode.shader', title: 'Shader', menu: ['View'], group: 'mode', accelerator: 'Mod+1', checked: () => workspace.mode === 'shader' },
  { id: 'mode.graph', title: 'Graph', menu: ['View'], group: 'mode', accelerator: 'Mod+2', checked: () => workspace.mode === 'graph' },
  { id: 'mode.reference', title: 'Reference', menu: ['View'], group: 'mode', accelerator: 'Mod+3', checked: () => workspace.mode === 'reference' },

  {
    id: 'view.toggleDock',
    title: 'Side Panel',
    menu: ['View'],
    group: 'layout',
    accelerator: 'Mod+B',
    // Blender's sidebar key; elsewhere N is a letter the pages may want
    get aliases() { return workspace.mode === 'graph' ? ['N'] : undefined },
    checked: () => workspace.dockVisible,
    run: () => { workspace.dockVisible = !workspace.dockVisible },
  },
  { id: 'view.toggleBottom', title: 'Bottom Panel', menu: ['View'], group: 'layout', accelerator: 'Mod+J', checked: () => workspace.bottomVisible, run: () => { workspace.bottomVisible = !workspace.bottomVisible } },
  // a matrix or a ring has no row to show; the preview pane draws those
  { id: 'view.ledStrip', title: 'LED Strip', menu: ['View'], group: 'layout', accelerator: 'Mod+Alt+L', checked: () => workspace.stripVisible, enabled: () => isStripLayout(config.layout), run: () => { workspace.stripVisible = !workspace.stripVisible } },
  // literal Ctrl on macOS as well: Spotlight owns Cmd+Space
  { id: 'view.maximize', title: 'Maximize Editor', menu: ['View'], group: 'layout', accelerator: 'Ctrl+Space', checked: isMaximized, run: toggleMaximize },
  { id: 'view.hideDock', title: 'Hide Side Panel', menu: ['View'], group: 'layout', accelerator: 'Mod+Alt+Shift+B', contextOnly: true, run: () => { workspace.dockVisible = false } },
  { id: 'view.hideBottom', title: 'Hide Bottom Panel', menu: ['View'], group: 'layout', accelerator: 'Mod+Alt+Shift+J', contextOnly: true, run: () => { workspace.bottomVisible = false } },
  ...DOCK_TABS.map((tab): Command => ({
    id: `view.panel.${tab.id}`,
    title: tab.label,
    menu: ['View', 'Show Panel'],
    group: 'layout',
    accelerator: `Mod+Shift+${{ parameters: 'D', output: 'T', inputs: 'I', problems: 'M', log: 'Y', glsl: 'E', performance: 'H' }[tab.id]}`,
    modes: [...tab.modes],
    run: () => showTab(tab.id),
  })),
  { id: 'view.resetLayout', title: 'Reset Layout', menu: ['View'], group: 'layout', accelerator: 'Mod+Alt+0', run: resetLayout },

  themeCommand('light', 'Light', 'Mod+Alt+Shift+L'),
  themeCommand('dark', 'Dark', 'Mod+Alt+Shift+D'),
  themeCommand('auto', 'System', 'Mod+Alt+Shift+S'),
  { id: 'view.commandPalette', title: 'Command Palette...', menu: ['View'], group: 'appearance', accelerator: 'Mod+K', aliases: ['Mod+Shift+P'], run: () => { palette.view = 'commands'; palette.open = true } },

  { id: 'playback.toggleAudio', title: () => (useEngine().audio.state.playing ? 'Pause Audio' : 'Play Audio'), menu: ['View'], group: 'playback', accelerator: 'Mod+Shift+Space', run: () => useEngine().toggleAudio() },
  { id: 'playback.resetTime', title: 'Reset Time', menu: ['View'], group: 'playback', accelerator: 'Mod+Shift+0', run: () => useEngine().resetTime() },
  { id: 'output.toggleStream', title: () => (useEngine().streaming.value ? 'Stop Streaming' : 'Start Streaming'), menu: ['View'], group: 'playback', accelerator: 'Mod+Shift+Enter', run: () => useEngine().toggleStream() },
  {
    id: 'output.devices',
    list: () => devices.value.map((device, index) => ({
      id: `output.device.${device.id}`,
      title: device.name,
      menu: ['View', 'Switch Device'],
      group: 'playback',
      accelerator: index < 9 ? `Mod+Alt+${index + 1}` : undefined,
      checked: () => activeDeviceId.value === device.id,
      run: () => setActiveDevice(device.id),
    })),
  },

  { id: 'shader.compile', title: 'Compile', menu: ['View'], group: 'editor', accelerator: 'Mod+Enter', modes: ['shader'], textKey: true },
  { id: 'shader.addFunction', title: 'Add Function...', menu: ['View'], group: 'editor', accelerator: 'Mod+Shift+A', modes: ['shader'], textKey: true },
  { id: 'shader.undo', title: 'Undo', menu: ['View'], group: 'editor', accelerator: 'Mod+Z', modes: ['shader'], textKey: true },
  { id: 'shader.redo', title: 'Redo', menu: ['View'], group: 'editor', accelerator: 'Mod+Shift+Z', modes: ['shader'], textKey: true },
  { id: 'shader.selectAll', title: 'Select All', menu: ['View'], group: 'editor', accelerator: 'Mod+A', modes: ['shader'], textKey: true },
  { id: 'graph.addNode', title: 'Add Node...', menu: ['View'], group: 'editor', accelerator: 'Shift+A', modes: ['graph'] },
  { id: 'graph.searchNodes', title: 'Search Nodes', menu: ['View'], group: 'editor', accelerator: 'Space', modes: ['graph'] },
  { id: 'graph.fitView', title: 'Fit View', menu: ['View'], group: 'editor', accelerator: 'Home', modes: ['graph'] },
  { id: 'graph.viewSelected', title: 'View Selected', menu: ['View'], group: 'editor', accelerator: 'NumpadDecimal', modes: ['graph'] },
  { id: 'graph.findNode', title: 'Find Node...', menu: ['View'], group: 'editor', accelerator: 'Mod+F', modes: ['graph'] },
  { id: 'graph.sendToShader', title: 'Send to Shader Mode', menu: ['View'], group: 'editor', accelerator: 'Mod+Alt+Enter', modes: ['graph'] },
  { id: 'graph.copyGlsl', title: 'Copy Generated GLSL', menu: ['View'], group: 'editor', accelerator: 'Mod+Alt+Shift+E', modes: ['graph'] },
  { id: 'graph.copy', title: 'Copy Nodes', menu: ['View'], group: 'clipboard', accelerator: 'Mod+C', modes: ['graph'], textKey: true },
  // Mod+X dissolves, as in Blender: on macOS the native Edit menu's Cut owns Cmd+X and the canvas reads its cut event as dissolve
  { id: 'graph.cut', title: 'Cut Nodes', menu: ['View'], group: 'clipboard', accelerator: 'Mod+Alt+X', modes: ['graph'], textKey: true },
  { id: 'graph.paste', title: 'Paste Nodes', menu: ['View'], group: 'clipboard', accelerator: 'Mod+V', modes: ['graph'], textKey: true },
  { id: 'graph.undo', title: 'Undo', menu: ['View'], group: 'clipboard', accelerator: 'Mod+Z', modes: ['graph'], textKey: true },
  // Cmd+Y is not redo on macOS
  { id: 'graph.redo', title: 'Redo', menu: ['View'], group: 'clipboard', accelerator: 'Mod+Shift+Z', aliases: isMac() ? undefined : ['Mod+Y'], modes: ['graph'], textKey: true },
  { id: 'graph.selectAll', title: 'Select All Nodes', menu: ['View'], group: 'clipboard', accelerator: 'Mod+A', modes: ['graph'], textKey: true },
  { id: 'graph.deselectAll', title: 'Deselect All', menu: ['View'], group: 'clipboard', accelerator: 'Alt+A', aliases: ['Escape'], modes: ['graph'] },
  { id: 'graph.invertSelection', title: 'Invert Selection', menu: ['View'], group: 'clipboard', accelerator: 'Mod+I', modes: ['graph'] },
  { id: 'graph.selectLinkedFrom', title: 'Select Linked From', menu: ['View'], group: 'clipboard', accelerator: 'L', modes: ['graph'] },
  { id: 'graph.selectLinkedTo', title: 'Select Linked To', menu: ['View'], group: 'clipboard', accelerator: 'Shift+L', modes: ['graph'] },
  { id: 'graph.delete', title: 'Delete Nodes', menu: ['View'], group: 'clipboard', accelerator: 'X', aliases: ['Backspace', 'Delete'], modes: ['graph'] },
  { id: 'graph.duplicate', title: 'Duplicate Nodes', menu: ['View'], group: 'nodes', accelerator: 'Shift+D', modes: ['graph'] },
  { id: 'graph.grab', title: 'Move Nodes', menu: ['View'], group: 'nodes', accelerator: 'G', modes: ['graph'] },
  { id: 'graph.dissolve', title: 'Dissolve Nodes', menu: ['View'], group: 'nodes', accelerator: 'Mod+X', modes: ['graph'], textKey: true },
  { id: 'graph.linkSelected', title: 'Link Selected Nodes', menu: ['View'], group: 'nodes', accelerator: 'F', modes: ['graph'] },
  { id: 'graph.toggleCollapse', title: 'Collapse Nodes', menu: ['View'], group: 'nodes', accelerator: 'H', modes: ['graph'] },
  // literal Ctrl on macOS as well, as Blender binds it there: Cmd+H hides the app
  { id: 'graph.hideUnusedSockets', title: 'Hide Unused Sockets', menu: ['View'], group: 'nodes', accelerator: 'Ctrl+H', modes: ['graph'] },
  { id: 'graph.mute', title: 'Mute Nodes', menu: ['View'], group: 'nodes', accelerator: 'M', modes: ['graph'] },
  { id: 'graph.rename', title: 'Rename Node', menu: ['View'], group: 'nodes', accelerator: 'F2', modes: ['graph'] },

  { id: 'log.copyLine', title: 'Copy Line', menu: ['View'], group: 'log', accelerator: 'Mod+Alt+Shift+C', enabled: () => !!logContext.value, run: copyLogLine },
  { id: 'log.copyAll', title: 'Copy All', menu: ['View'], group: 'log', accelerator: 'Mod+Alt+Shift+X', enabled: () => shownLogs.value.length > 0, run: copyAllLogs },
  { id: 'log.clear', title: 'Clear', menu: ['View'], group: 'log', accelerator: 'Mod+Alt+Shift+K', run: clearLogs },

  { id: 'problems.copyMessage', title: 'Copy Message', menu: ['View'], group: 'problems', accelerator: 'Mod+Alt+Shift+M', modes: ['shader', 'graph'], enabled: () => !!contextProblem.value, run: () => contextProblem.value && copyText(contextProblem.value.message) },
  { id: 'problems.goto', title: () => (contextProblem.value?.nodeId ? 'Reveal Node' : 'Go to Line'), menu: ['View'], group: 'problems', accelerator: 'Mod+Alt+Shift+G', modes: ['shader', 'graph'], enabled: () => !!contextProblem.value },

  { id: 'reference.focusSearch', title: 'Focus Search', menu: ['View'], group: 'reference', accelerator: '/', aliases: ['Mod+F'], modes: ['reference'] },
  { id: 'reference.copyEntry', title: 'Copy Signature', menu: ['View'], group: 'reference', accelerator: 'Mod+C', modes: ['reference'], textKey: true },

  { id: 'help.reference', title: 'Shader Reference', menu: ['Help'], accelerator: 'F1' },
  { id: 'help.shortcuts', title: 'Keyboard Shortcuts', menu: ['Help'], accelerator: 'Mod+Alt+K', run: () => { palette.view = 'shortcuts'; palette.open = true } },
  { id: 'help.launchScreen', title: 'Launch Screen', menu: ['Help'], accelerator: 'Mod+Alt+Shift+W' },
  { id: 'help.about', title: 'About WLEDtoy', menu: ['Help'], accelerator: 'Shift+F1' },
])
