export const VERT = `#version 300 es
in vec2 p;
void main() { gl_Position = vec4(p, 0.0, 1.0); }`

// copies a feedback target to the canvas
export const PRESENT = `#version 300 es
precision highp float;
uniform sampler2D source;
out vec4 color;
void main() { color = vec4(texelFetch(source, ivec2(gl_FragCoord.xy), 0).rgb, 1.0); }`

export const UNIFORMS = [
  'iResolution', 'iTime', 'iFrame', 'iLedCount', 'iScanY', 'iAudio', 'iImage', 'iControl',
  'iAudioBands', 'iAudioHistory', 'iAudioWave', 'iAudioHeads', 'iAudioFeatures', 'iAudioBandsExtra', 'iAudioHistoryExtra', 'iAudioHistoryHeadExtra', 'iLayout', 'iLayoutCount', 'iPrevFrame', 'iTimeDelta', 'iImages', 'iState', 'iGlobal',
] as const

export type UniformLocations = Partial<Record<(typeof UNIFORMS)[number], WebGLUniformLocation | null>>
