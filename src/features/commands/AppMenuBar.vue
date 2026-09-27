<script setup lang="ts">
import { computed, h, type FunctionalComponent } from 'vue'
import {
  MenubarCheckboxItem, MenubarContent, MenubarItem, MenubarMenu, MenubarPortal, MenubarRoot,
  MenubarSeparator, MenubarSub, MenubarSubContent, MenubarSubTrigger, MenubarTrigger,
} from 'reka-ui'
import { commandTitle, formatAccelerator, isChecked, isEnabled, menuTree, runCommand, type MenuNode } from '@/lib/app/commands'

const tree = computed(menuTree)

const content = 'app-menu z-50 min-w-52 rounded-[6px] border border-(--app-hairline) bg-(--app-floating) p-1 text-[12px] text-default shadow-xl outline-none'
const item = 'group flex h-[22px] cursor-default items-center rounded-[3px] pe-2 ps-1 outline-none data-[highlighted]:bg-primary data-[highlighted]:text-inverted data-[state=open]:bg-accented data-[disabled]:text-dimmed'
const trailing = 'ms-auto ps-6 text-muted group-data-[highlighted]:text-inverted group-data-[disabled]:text-dimmed'

// a render function because submenus nest: a template would need a second component file for the recursion
const MenuItems: FunctionalComponent<{ items: MenuNode[] }> = (props) => props.items.map((node) => {
  if (node.type === 'separator') return h(MenubarSeparator, { class: 'mx-1 my-1 h-px bg-(--app-hairline)' })
  if (node.type === 'submenu') {
    return h(MenubarSub, null, () => [
      h(MenubarSubTrigger, { class: item }, () => [h('span', { class: 'w-4 shrink-0' }), node.title, h('span', { class: trailing }, '›')]),
      h(MenubarPortal, null, () => h(MenubarSubContent, { class: content, sideOffset: 2, alignOffset: -5 }, () => h(MenuItems, { items: node.items }))),
    ])
  }
  const { command } = node
  return h(command.checked ? MenubarCheckboxItem : MenubarItem, {
    class: item,
    disabled: !isEnabled(command),
    'data-command': command.id,
    ...(command.checked ? { modelValue: isChecked(command) } : {}),
    onSelect: () => void runCommand(command.id),
  }, () => [
    h('span', { class: 'w-4 shrink-0 text-center' }, isChecked(command) ? '✓' : ''),
    commandTitle(command),
    command.accelerator ? h('span', { class: `${trailing} tracking-wide` }, formatAccelerator(command.accelerator)) : null,
  ])
})
MenuItems.props = ['items']
</script>

<template>
  <MenubarRoot class="app-menubar flex shrink-0 items-center">
    <MenubarMenu v-for="menu in tree" :key="menu.title" :value="menu.title">
      <MenubarTrigger
        class="h-[22px] rounded-[4px] px-2 text-[12px] text-muted outline-none hover:bg-(--app-hover) hover:text-default focus-visible:bg-(--app-hover) data-[state=open]:bg-accented data-[state=open]:text-default"
      >
        {{ menu.title }}
      </MenubarTrigger>
      <MenubarPortal>
        <MenubarContent :class="content" align="start" :side-offset="6">
          <MenuItems :items="menu.items" />
        </MenubarContent>
      </MenubarPortal>
    </MenubarMenu>
  </MenubarRoot>
</template>
