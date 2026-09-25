/**
 * Structural checks over rendered nodes, one per class of visual artifact. Each returns a line per violation,
 * so a failing test names the node and the element. Rects are compared, so they hold at any canvas zoom.
 */
const SLACK = 0.75

const nodesIn = (root: ParentNode) => [...root.querySelectorAll<HTMLElement>('.vue-flow__node')]
const name = (node: HTMLElement, el?: Element) => `${node.dataset.id}${el ? ` <${el.tagName.toLowerCase()} class="${el.getAttribute('class') ?? ''}">` : ''}`
const centerX = (r: DOMRect) => r.left + r.width / 2
const centerY = (r: DOMRect) => r.top + r.height / 2
const clips = (el: Element) => ['hidden', 'clip', 'auto', 'scroll'].includes(getComputedStyle(el).overflowX)

export function emptyNodes(root: ParentNode): string[] {
  return nodesIn(root).filter((node) => {
    const rect = node.querySelector('.nui-node')?.getBoundingClientRect()
    return !rect || rect.width < 1 || rect.height < 1
  }).map((node) => name(node))
}

/** Everything but a socket, which straddles the edge on purpose, stays between the node's left and right edges. */
export function horizontalOverflow(root: ParentNode): string[] {
  return nodesIn(root).flatMap((node) => {
    const box = node.querySelector('.nui-node')!.getBoundingClientRect()
    return [...node.querySelectorAll<HTMLElement>('.nui-node *:not(.vue-flow__handle)')]
      .filter((el) => {
        const rect = el.getBoundingClientRect()
        return rect.width > 0 && rect.height > 0 && (rect.left < box.left - SLACK || rect.right > box.right + SLACK)
      })
      .map((el) => `${name(node, el)} leaves the node horizontally`)
  })
}

/** A socket is centered on the node's edge, inside its own row, or inside the header when the node is folded, without touching its neighbor. */
export function detachedSockets(root: ParentNode): string[] {
  return nodesIn(root).flatMap((node) => {
    const box = node.querySelector('.nui-node')!.getBoundingClientRect()
    const problems: string[] = []
    for (const side of ['left', 'right'] as const) {
      const sockets = [...node.querySelectorAll<HTMLElement>(`.vue-flow__handle-${side}`)]
      sockets.forEach((socket, i) => {
        const rect = socket.getBoundingClientRect()
        const holder = (socket.closest('.nui-row') ?? socket.closest('.nui-header'))?.getBoundingClientRect()
        if (rect.width < 1 || rect.height < 1) problems.push(`${name(node, socket)} ${socket.dataset.handleid} has no size`)
        if (Math.abs(centerX(rect) - box[side]) > 1.5) problems.push(`${name(node, socket)} ${socket.dataset.handleid} is ${(centerX(rect) - box[side]).toFixed(1)}px off the ${side} edge`)
        if (!holder || centerY(rect) < holder.top || centerY(rect) > holder.bottom) problems.push(`${name(node, socket)} ${socket.dataset.handleid} is outside its row`)
        if (socket.closest('.nui-header') && holder && (rect.top < holder.top - SLACK || rect.bottom > holder.bottom + SLACK)) problems.push(`${name(node, socket)} ${socket.dataset.handleid} sticks out of the folded header`)
        if (i > 0 && rect.top < sockets[i - 1].getBoundingClientRect().bottom - SLACK) problems.push(`${name(node, socket)} ${socket.dataset.handleid} overlaps the socket above it`)
      })
    }
    return problems
  })
}

/** A range at its minimum, or with no range at all, paints no fill, and no fill reaches outside its field. */
export function strayRangeFills(root: ParentNode): string[] {
  return nodesIn(root).flatMap((node) => [...node.querySelectorAll<HTMLElement>('.nui-range-fill')].flatMap((fill) => {
    const rect = fill.getBoundingClientRect()
    const field = fill.parentElement!.getBoundingClientRect()
    const style = getComputedStyle(fill)
    const empty = parseFloat(fill.style.width) === 0
    const painted = rect.width + parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth) + (style.outlineStyle === 'none' ? 0 : parseFloat(style.outlineWidth))
    return [
      ...(empty && painted > 0 && style.visibility !== 'hidden' && style.display !== 'none' ? [`${name(node, fill)} is empty but paints ${painted.toFixed(1)}px`] : []),
      ...(rect.right > field.right + SLACK || rect.left < field.left - SLACK ? [`${name(node, fill)} leaves its field`] : []),
    ]
  }))
}

/** Text that does not fit is cut with an ellipsis, never mid-glyph, and never loses its top or bottom. */
export function clippedText(root: ParentNode): string[] {
  return nodesIn(root).flatMap((node) => [...node.querySelectorAll<HTMLElement>('.nui-node *')].flatMap((el) => {
    const hasText = el instanceof HTMLInputElement ? el.type !== 'color' && el.type !== 'file' && el.value !== '' : [...el.childNodes].some((child) => child.nodeType === Node.TEXT_NODE && child.textContent!.trim())
    if (!hasText) return []
    const style = getComputedStyle(el)
    return [
      ...(el.scrollWidth > el.clientWidth + 1 && el.clientWidth < 2 * parseFloat(style.fontSize) ? [`${name(node, el)} "${(el instanceof HTMLInputElement ? el.value : el.textContent!).trim()}" is squeezed to under two characters`] : []),
      ...(el.scrollWidth > el.clientWidth + 1 && style.textOverflow !== 'ellipsis' ? [`${name(node, el)} "${(el instanceof HTMLInputElement ? el.value : el.textContent!).trim()}" is cut without an ellipsis`] : []),
      ...(el.scrollHeight > el.clientHeight + 1 && style.overflowY !== 'visible' ? [`${name(node, el)} "${el.textContent!.trim()}" is cut vertically`] : []),
    ]
  }))
}

/** Widgets that share a row sit side by side. */
export function overlappingSiblings(root: ParentNode): string[] {
  return nodesIn(root).flatMap((node) => [...node.querySelectorAll<HTMLElement>('.nui-header, .nui-row, .nui-inline, .nui-field, .nui-button-group, .nui-color, .nui-checkbox, .nui-dropdown-button')].flatMap((row) => {
    const items = [...row.children].filter((el) => !el.matches('.vue-flow__handle') && getComputedStyle(el).position !== 'absolute' && el.getBoundingClientRect().width > 0)
    return items.slice(1).filter((el, i) => el.getBoundingClientRect().left < items[i].getBoundingClientRect().right - SLACK).map((el) => `${name(node, el)} overlaps the widget before it`)
  }))
}

/** An input fills its field from the left edge or follows a label; a gap before it shows the field's own color as a sliver. */
export function fieldSlivers(root: ParentNode): string[] {
  return nodesIn(root).flatMap((node) => [...node.querySelectorAll<HTMLElement>('.nui-field > input')]
    .filter((input) => !input.previousElementSibling && input.getBoundingClientRect().left - input.parentElement!.getBoundingClientRect().left > SLACK)
    .map((input) => `${name(node, input)} leaves a strip of its field uncovered`))
}

/**
 * A focus ring is drawn whole or not at all: an outline on an input inside a clipping field shows only the side that
 * falls in the field's padding, a colored sliver next to the caret.
 */
export function clippedFocusRings(root: ParentNode): string[] {
  const previous = document.activeElement as HTMLElement | null
  const problems = nodesIn(root).flatMap((node) => [...node.querySelectorAll<HTMLElement>('input:not([type=color]):not([type=file]), button:not([tabindex="-1"]), [tabindex="0"]')].flatMap((el) => {
    el.focus({ preventScroll: true })
    const style = getComputedStyle(el)
    const reach = style.outlineStyle === 'none' ? 0 : parseFloat(style.outlineWidth) + Math.max(0, parseFloat(style.outlineOffset))
    if (document.activeElement !== el || reach === 0) return []
    const rect = el.getBoundingClientRect()
    for (let parent = el.parentElement; parent && !parent.matches('.nui-node'); parent = parent.parentElement) {
      if (!clips(parent)) continue
      const box = parent.getBoundingClientRect()
      const scale = rect.width / el.offsetWidth || 1
      const cut = [rect.left - box.left, box.right - rect.right, rect.top - box.top, box.bottom - rect.bottom].map((room) => room < reach * scale - SLACK)
      if (cut.some(Boolean) && !cut.every(Boolean)) return [`${name(node, el)} has a focus ring its field cuts on ${cut.filter(Boolean).length} of 4 sides`]
    }
    return []
  }))
  ;(document.activeElement as HTMLElement | null)?.blur()
  previous?.focus({ preventScroll: true })
  return problems
}

export const galleryChecks = { emptyNodes, horizontalOverflow, detachedSockets, strayRangeFills, clippedText, overlappingSiblings, fieldSlivers, clippedFocusRings }
