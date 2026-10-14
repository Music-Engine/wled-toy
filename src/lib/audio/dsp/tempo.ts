export interface Beat {
  bpm: number
  /** 0 at a beat, rising to 1 just before the next. */
  phase: number
  /** True on the hop where the phase wrapped. */
  beat: boolean
  /** 0 to 1: how periodic the onsets are. Low when there is no steady pulse to lock to. */
  confidence: number
}

/**
 * Tempo and beat phase from an onset-strength signal. The tempo is the lag with the strongest
 * autocorrelation over the last few seconds, weighted toward 120 BPM to settle the half/double
 * ambiguity. The phase is a clock that free-runs at that tempo and is pulled toward the offset
 * that best lines up with recent onsets, so it keeps counting through a break and recovers after it.
 */
export class TempoTracker {
  private readonly history: Float32Array
  private head = 0
  private filled = 0
  private sinceEstimate = 0
  private bpm = 120
  private candidate = { bpm: 0, votes: 0 }
  private phase = 0
  private confidence = 0

  constructor(
    private readonly hopRate: number,
    private readonly minBpm = 60,
    private readonly maxBpm = 200,
    seconds = 6,
  ) {
    this.history = new Float32Array(Math.round(seconds * hopRate))
  }

  process(onsetStrength: number): Beat {
    this.history[this.head] = onsetStrength
    this.head = (this.head + 1) % this.history.length
    this.filled = Math.min(this.history.length, this.filled + 1)

    // re-estimate four times a second; the clock below runs every hop
    if (++this.sinceEstimate >= this.hopRate / 4 && this.filled > this.hopRate * 2) {
      this.sinceEstimate = 0
      this.estimate()
    }

    const before = this.phase
    this.phase = (this.phase + this.bpm / 60 / this.hopRate) % 1
    return { bpm: this.bpm, phase: this.phase, beat: this.phase < before, confidence: this.confidence }
  }

  /** Value `age` hops ago, 0 being the newest. */
  private past(age: number): number {
    return this.history[(this.head - 1 - age + this.history.length * 2) % this.history.length]
  }

  private estimate() {
    const n = this.filled
    let mean = 0
    for (let i = 0; i < n; i++) mean += this.past(i)
    mean /= n
    const acf = (lag: number) => {
      let sum = 0
      for (let i = 0; i + lag < n; i++) sum += (this.past(i) - mean) * (this.past(i + lag) - mean)
      return sum / (n - lag)
    }
    const energy = acf(0)
    if (energy < 1e-9) {
      this.confidence = 0
      return
    }

    const minLag = Math.floor((60 / this.maxBpm) * this.hopRate)
    const maxLag = Math.min(Math.ceil((60 / this.minBpm) * this.hopRate), Math.floor(n / 2) - 1)
    const scores = new Float32Array(maxLag + 2)
    for (let lag = minLag - 1; lag <= maxLag + 1; lag++) {
      const octaves = Math.log2(60 / (lag / this.hopRate) / 120)
      scores[lag] = (acf(lag) + 0.5 * acf(lag * 2 < n ? lag * 2 : lag)) * Math.exp(-0.5 * octaves * octaves)
    }
    let best = minLag
    for (let lag = minLag; lag <= maxLag; lag++) if (scores[lag] > scores[best]) best = lag
    // a parabola through the peak and its neighbors recovers tempo between whole hops
    const [a, b, c] = [scores[best - 1], scores[best], scores[best + 1]]
    const lag = best + (a - 2 * b + c !== 0 ? (0.5 * (a - c)) / (a - 2 * b + c) : 0)
    const found = (60 * this.hopRate) / lag
    this.confidence = Math.min(1, Math.max(0, acf(best) / energy))

    if (Math.abs(found - this.bpm) / this.bpm < 0.04) {
      this.bpm += (found - this.bpm) * 0.3
      this.candidate.votes = 0
    } else if (Math.abs(found - this.candidate.bpm) / found < 0.04) {
      // a different tempo has to win a few times in a row before the clock jumps to it
      if (++this.candidate.votes >= 3) {
        this.bpm = found
        this.candidate.votes = 0
      }
    } else {
      this.candidate = { bpm: found, votes: 1 }
    }
    this.alignPhase()
  }

  /** Finds how long ago the most recent beat was by laying a pulse train over the onset history, and steers the clock there. */
  private alignPhase() {
    const period = (60 * this.hopRate) / this.bpm
    let bestOffset = 0
    let bestSum = -Infinity
    for (let offset = 0; offset < period; offset++) {
      let sum = 0
      for (let k = 0; offset + k * period < this.filled - 1; k++) sum += this.past(Math.round(offset + k * period))
      if (sum > bestSum) {
        bestSum = sum
        bestOffset = offset
      }
    }
    const target = (bestOffset / period) % 1
    const error = ((target - this.phase + 1.5) % 1) - 0.5
    this.phase = (this.phase + error * 0.5 + 1) % 1
  }
}
