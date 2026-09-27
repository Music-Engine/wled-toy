export const Format = {
  /** A dash for a reading that is missing or not finite. */
  fixed: (value: number | null, decimals: number) => (value == null || !Number.isFinite(value) ? '-' : value.toFixed(decimals)),
  /** Minutes, seconds and tenths, as the transport shows the running time: `02:05.3`. */
  clock: (seconds: number) => {
    const tenths = Math.floor(seconds * 10)
    return `${String(Math.floor(tenths / 600)).padStart(2, '0')}:${String(Math.floor(tenths / 10) % 60).padStart(2, '0')}.${tenths % 10}`
  },
  duration: (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`,
}
