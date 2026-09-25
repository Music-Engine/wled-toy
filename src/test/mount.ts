import { createApp, h, ref, type Component, type Ref } from 'vue'
import '@/features/node-ui/node-ui.css'

/** Mounts a widget with a live `modelValue`, inside a `.nui` scope of fixed width so pixel math in tests is stable. */
export function mountField<T>(component: Component, initial: T, props: Record<string, unknown> = {}): { value: Ref<T>; root: HTMLElement; unmount(): void } {
  const value = ref(initial) as Ref<T>
  const root = document.createElement('div')
  root.className = 'nui'
  root.style.cssText = 'width: 200px; margin: 40px'
  document.body.append(root)
  const app = createApp({ render: () => h(component, { ...props, modelValue: value.value, 'onUpdate:modelValue': (next: T) => (value.value = next) }) })
  app.mount(root)
  return { value, root, unmount: () => { app.unmount(); root.remove() } }
}
