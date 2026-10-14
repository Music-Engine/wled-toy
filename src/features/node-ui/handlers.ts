import type { Component } from 'vue'
import type { Socket } from '@/lib/graph'
import AudioPreview from './bodies/AudioPreview.vue'
import ImagePicker from './bodies/ImagePicker.vue'
import MidiLearn from './bodies/MidiLearn.vue'
import ViewerScope from './bodies/ViewerScope.vue'
import CheckboxField from './fields/CheckboxField.vue'
import ColorSwatch from './fields/ColorSwatch.vue'
import DropdownField from './fields/DropdownField.vue'
import GradientEditor from './fields/GradientEditor.vue'
import RangeField from './fields/RangeField.vue'
import TextField from './fields/TextField.vue'
import VectorField from './fields/VectorField.vue'

/**
 * Edits one socket value. Every widget takes `modelValue`, emits `update:modelValue`, and may
 * emit `invalid` while the user has typed something it cannot use.
 */
export interface TypeHandler {
  component: Component
  /** Inline widgets replace the socket label and take it as `label`; block widgets sit on their own row under it. */
  layout: 'inline' | 'block'
}

/** A generic socket holds a number or a vector, so its value decides the widget. */
export function handlerFor(socket: Socket, value: unknown): TypeHandler | undefined {
  if (socket.type.id === 'genType') return Array.isArray(value) ? handlers.vec3 : handlers.float
  return handlers[socket.type.id]
}

/**
 * Nodes that show more than sockets get a body of their own above them, by node id (the React editor's customNodeHandlers).
 * A body receives `nodeId` and `values`, and may emit `update` with values to merge into the node.
 */
export const nodeBodies: Record<string, Component> = {
  audioSource: AudioPreview,
  imageTexture: ImagePicker,
  midiIn: MidiLearn,
  viewer: ViewerScope,
}

/** Widgets by type id, the counterpart of `typeHandlers` in the React editor. */
const handlers: Record<string, TypeHandler> = {
  float: { component: RangeField, layout: 'inline' },
  int: { component: RangeField, layout: 'inline' },
  vec2: { component: VectorField, layout: 'block' },
  vec3: { component: VectorField, layout: 'block' },
  vec4: { component: VectorField, layout: 'block' },
  color: { component: ColorSwatch, layout: 'inline' },
  bool: { component: CheckboxField, layout: 'inline' },
  enum: { component: DropdownField, layout: 'block' },
  text: { component: TextField, layout: 'inline' },
  ramp: { component: GradientEditor, layout: 'block' },
}
