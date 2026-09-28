import { createHash } from 'node:crypto'
import { expect, it } from 'vitest'
import { PRELUDE } from '@/lib/shader/prelude'

// Pinned at the split of prelude.ts; a deliberate prelude change updates it
it('joins its parts into the text the single prelude file held', () => {
  expect(createHash('sha256').update(PRELUDE).digest('hex')).toBe('ecae2e895c991b20b1b40973773b7676b05daabd1afca4372eebf53e2f1b9806')
})
