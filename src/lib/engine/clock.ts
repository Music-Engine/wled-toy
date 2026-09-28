import type { FrameParams } from '@/lib/engine/render/renderer'

/** One period after `due`, so lateness never accumulates; a period after `now` once a whole period behind, skipping not bursting */
export function nextDeadline(due: number, period: number, now: number): number {
  const next = due + period
  return next > now ? next : now + period
}

/** Calls `tick` on deadlines one period apart; browsers deliver setInterval late, so it chases them */
export class DeadlineTimer {
  private due = 0
  private timer: ReturnType<typeof setTimeout> | undefined

  constructor(private readonly tick: () => void, private readonly readPeriod: () => number) {}

  restart() {
    clearTimeout(this.timer)
    this.due = performance.now()
    this.schedule()
  }

  stop() {
    clearTimeout(this.timer)
  }

  private schedule() {
    const now = performance.now()
    this.due = nextDeadline(this.due, this.readPeriod(), now)
    this.timer = setTimeout(this.onDeadline, Math.max(0, this.due - now))
  }

  // Scheduled before the tick, so a throwing tick keeps the clock, as setInterval does
  private readonly onDeadline = () => {
    this.schedule()
    this.tick()
  }
}

/** Shader time and preview frame count, written into one reused FrameParams */
export class FrameClock {
  frame = 0
  private startTime = performance.now()
  // One object for both passes so neither allocates per frame; the renderer keeps no reference
  private readonly params: FrameParams = { time: 0, dt: 0, frame: 0, ledCount: 0, scanY: 0 }

  /** Shader seconds since the last reset */
  readElapsed() {
    return (performance.now() - this.startTime) / 1000
  }

  reset() {
    this.startTime = performance.now()
    this.frame = 0
  }

  fillParams(dt: number, ledCount: number, scanY: number): FrameParams {
    const { params } = this
    params.time = this.readElapsed()
    params.dt = dt
    params.frame = this.frame
    params.ledCount = ledCount
    params.scanY = scanY
    return params
  }
}
