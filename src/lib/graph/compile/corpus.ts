import type { NodeGraph } from '@/lib/graph/model/doc'
import { readGraphFile } from '@/lib/graph/model/file'
import { listItems } from '@/lib/graph/registry'
import { placeAlone } from '@/lib/graph/testing'

const files = import.meta.glob('/graphs/**/*.wledgraph', { query: '?raw', import: 'default', eager: true }) as Record<string, string>

export const listCorpusGraphs = (): [string, NodeGraph][] =>
  Object.entries(files).map(([path, text]) => [path.split('/').pop()!.replace('.wledgraph', ''), readGraphFile(text).doc])

export const listCorpusKinds = (): [string, NodeGraph][] => listItems().map((item) => [item.id, placeAlone(item)])
