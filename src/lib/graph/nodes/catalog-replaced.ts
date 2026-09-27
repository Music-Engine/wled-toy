// Catalog functions w/ a graph node of their own (ported from three.js shader editor), which wins
export const REPLACED_FUNCTIONS = [
  'brightnessContrast', 'checkerboard', 'noise', 'image', 'hsv2rgb', 'rgb2hsv', 'gammaCorrect', 'clamp', 'remap', 'random',
  'tile', 'polar', 'mirror', 'fromCenter', 'rotate2d',
  // Math operations
  'sin', 'cos', 'abs', 'floor', 'fract', 'mod', 'min', 'max', 'pow', 'exp', 'sqrt', 'atan', 'step', 'saturate',
  // Vector Math, Wave, Mapping + Image Texture, Palette presets, Hue/Saturation/Value, noise textures, Time
  'length', 'distance', 'dot', 'normalize', 'mix',
  'sawWave', 'triangleWave', 'squareWave', 'sineWave', 'easeInOut', 'bounce', 'pulse',
  'imageScroll', 'imagePixelate', 'imageMirror', 'imageZoom', 'imageLuma',
  'rainbow', 'heatColor', 'hueShift', 'saturation', 'hash', 'fbm', 'voronoi',
  // Covered by Audio node and its samplers
  'fft', 'fftLog', 'waveform', 'band', 'bass', 'mid', 'treble', 'energy', 'beat',
]
