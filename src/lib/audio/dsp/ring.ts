/** Rows of equal width written in a circle: the spectrogram history the shader scrolls through. */
export class RingRows {
  readonly data: Float32Array
  /** Row that will be written next; the newest row is the one before it. */
  head = 0

  constructor(
    readonly width: number,
    readonly rows: number,
  ) {
    this.data = new Float32Array(width * rows)
  }

  push(row: Float32Array) {
    this.data.set(row.subarray(0, this.width), this.head * this.width)
    this.head = (this.head + 1) % this.rows
  }

  /** Row written `age` pushes ago, 0 being the newest. */
  row(age: number): Float32Array {
    const index = (this.head - 1 - age + this.rows * 2) % this.rows
    return this.data.subarray(index * this.width, (index + 1) * this.width)
  }
}

/** The last `length` samples, for reading the waveform with a delay. */
export class SampleRing {
  private readonly data: Float32Array
  private head = 0

  constructor(readonly length: number) {
    this.data = new Float32Array(length)
  }

  push(samples: Float32Array) {
    for (let i = 0; i < samples.length; i++) {
      this.data[this.head] = samples[i]
      this.head = (this.head + 1) % this.length
    }
  }

  /** Copies `out.length` samples ending `delay` samples before the newest. */
  read(out: Float32Array, delay = 0): Float32Array {
    const start = this.head - delay - out.length + this.length * 2
    for (let i = 0; i < out.length; i++) out[i] = this.data[(start + i) % this.length]
    return out
  }
}
