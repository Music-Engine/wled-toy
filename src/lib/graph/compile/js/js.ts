// The JS backend: the Program's frame steps with each node's `frame` body and state declaration looked up at build version.
import type { FramePlan } from './frame'
import { nodeShape, type Program } from '@/lib/graph/compile/front-end/program'

export function js(program: Program): FramePlan {
  const steps = program.frame.map((step) => {
    const node = program.nodes[step.nodeId]
    const shape = nodeShape(node)
    return { nodeId: step.nodeId, kind: node.kind, frame: shape.frame!, state: shape.state, resolved: node.resolved, inputs: step.inputs, dims: step.dims }
  })
  return { steps, exports: program.uniforms, resources: program.resources }
}
