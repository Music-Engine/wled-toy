import { CATEGORIES, NODES, categoryById, socketColor, type ShaderNode } from './catalog'
import { directory, leaf, type MenuEntry, type MenuFs } from './menu-fs'

/** Everything the shader editor can insert, one directory per category. */
export const SHADER_FS: MenuFs<ShaderNode> = {
  title: 'Add',
  items: CATEGORIES.map((c) =>
    directory(
      c.label,
      NODES.filter((n) => n.category === c.id).map((n) => leaf(n)),
      { icon: c.icon, color: c.color },
    ),
  ).filter((d) => d.items.length > 0),
}

export function describeShaderNode(node: ShaderNode): MenuEntry {
  const category = categoryById.get(node.category)!
  const output = node.kind === 'recipe' ? 'code' : node.returns === 'genType' ? 'result' : node.returns
  return {
    id: node.name,
    title: node.title,
    description: node.doc,
    signature: node.signature,
    keywords: node.name,
    color: category.color,
    icon: category.icon,
    inputs: node.params.map((p) => ({ label: p.name, type: p.type, color: socketColor(p.type) })),
    outputs: node.returns === 'void' ? [] : [{ label: output, color: socketColor(node.returns) }],
    note: node.kind === 'uniform' ? 'uniform' : undefined,
  }
}
