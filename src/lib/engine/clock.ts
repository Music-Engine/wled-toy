/** The deadline after `due`: one period on, so lateness never accumulates, or one period from `now` when the clock fell a whole period behind, so it skips instead of bursting. */
export function nextDeadline(due: number, period: number, now: number): number {
  const next = due + period
  return next > now ? next : now + period
}
