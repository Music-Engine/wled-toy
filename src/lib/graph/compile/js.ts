// The JS backend: the Program's frame steps with each node's `frame` body and state factory looked up at build version.
import type { FramePlan } from './frame'
import { shapeOf, type Program } from './program'

export function js(program: Program): FramePlan {
  const steps = program.frame.map((step) => {
    const node = program.nodes[step.nodeId]
    const shape = shapeOf(node)
    return { nodeId: step.nodeId, kind: node.kind, frame: shape.frame!, state: shape.state, resolved: node.resolved, inputs: step.inputs, dims: step.dims }
  })
  return { steps, exports: program.uniforms, resources: program.resources }
}
