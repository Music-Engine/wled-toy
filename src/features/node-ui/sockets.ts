import type { DataType } from '@/lib/graph'

/** How the editor draws each type a link can carry: the socket and link color, and what an unlinked stream socket uses. */
const SOCKETS: Record<string, { color: string; unlinked?: string }> = {
  float: { color: '#a1a1a1' },
  int: { color: '#4772b3' },
  genType: { color: '#a1a1a1' },
  vec2: { color: '#6363c7' },
  vec3: { color: '#6363c7' },
  color: { color: '#c7c729' },
  vec4: { color: '#c7c729' },
  sampler2D: { color: '#29c7c7' },
  audio: { color: '#e0853d', unlinked: 'live source' },
  spectrum: { color: '#d9568b', unlinked: 'default FFT' },
}

function socketOf(type: DataType<any>) {
  const socket = SOCKETS[type.id]
  if (!socket) throw new Error(`${type.label} cannot be linked, so it has no socket to draw`)
  return socket
}

export const socketColor = (type: DataType<any>): string => socketOf(type).color

/** Shown on an unlinked stream socket: what it listens to instead. */
export const unlinkedStream = (type: DataType<any>): string => socketOf(type).unlinked ?? ''
