import { assert, createAndJoin, drawLine, inkBounds, launchPair, startMatch, startStack } from './harness.mjs'

const stack = await startStack({ CHAOS_FORCE: 'memory' })
const { browser, a, b } = await launchPair()
try {
  await createAndJoin(a, b)
  await startMatch(a)
  await a.waitForTimeout(3000)
  await drawLine(a, { x: 0.3, y: 0.3 }, { x: 0.7, y: 0.3 })
  assert((await inkBounds(a)).count > 50, 'drawer sees ink before the cutoff')
  await a.waitForTimeout(10_800) // MEMORY_HIDE_AFTER_MS + margin
  assert((await inkBounds(a)).count === 0, 'drawer canvas dark after 10s')
  const guesserBefore = (await inkBounds(b)).count
  assert(guesserBefore > 50, 'guesser still sees the drawing')
  await a.waitForSelector('.room-memory-veil')
  // blind strokes keep relaying
  await drawLine(a, { x: 0.3, y: 0.6 }, { x: 0.7, y: 0.6 })
  await a.waitForTimeout(600)
  assert((await inkBounds(a)).count === 0, 'drawer stays blind while drawing')
  assert((await inkBounds(b)).count > guesserBefore, 'guesser receives the blind strokes')
  console.log('memory e2e: PASS')
} finally {
  await browser.close()
  stack.stop()
}
