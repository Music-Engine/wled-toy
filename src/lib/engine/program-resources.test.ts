import { expect, it } from 'vitest'
import { readShaderResources } from './program-resources'

it('declares an audio read only when the code, not a comment, names it', () => {
  expect(readShaderResources('// iAudioFeatures\n/* spectrumPeak */\nvoid mainImage(out vec4 c, vec2 uv, float ledIndex) {}')).toEqual({})
  expect(readShaderResources('float x = iAudioFeatures[0].x;')).toEqual({ audioFeatures: [true] })
})
