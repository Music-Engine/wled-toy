// What the gate compiles: every graph under graphs/ and every kind with a body alone, by name.
import type { NodeGraph } from '@/lib/graph/model/doc'
import { readGraphFile } from '@/lib/graph/model/file'
import { allItems } from '@/lib/graph/registry'
import { alone } from '@/lib/graph/testing'

const files = import.meta.glob('/graphs/**/*.wledgraph', { query: '?raw', import: 'default', eager: true }) as Record<string, string>

export const corpusGraphs = (): [string, NodeGraph][] =>
  Object.entries(files).map(([path, text]) => [path.split('/').pop()!.replace('.wledgraph', ''), readGraphFile(text).doc])

export const corpusKinds = (): [string, NodeGraph][] => allItems().filter((item) => item.base.body).map((item) => [item.id, alone(item)])
