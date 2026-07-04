import { assert, createAndJoin, drawLine, inkBounds, launchPair, startMatch, startStack } from './harness.mjs'

const stack = await startStack({ CHAOS_FORCE: 'jitter' })
const { browser, a, b } = await launchPair()
try {
  await createAndJoin(a, b)
  await startMatch(a)
  await a.waitForTimeout(3000)
  // a horizontal line: without jitter its ink band is ~4px tall (line width)
  await drawLine(a, { x: 0.2, y: 0.5 }, { x: 0.8, y: 0.5 }, 45)
  await a.waitForTimeout(600)
  const drawer = await inkBounds(a)
  const guesser = await inkBounds(b)
  assert(drawer.maxY - drawer.minY > 9, `drawer stroke wobbles (band=${(drawer.maxY - drawer.minY).toFixed(1)}px)`)
  assert(guesser.maxY - guesser.minY > 9, `guesser sees the same wobble (band=${(guesser.maxY - guesser.minY).toFixed(1)}px)`)
  console.log('jitter e2e: PASS')
} finally {
  await browser.close()
  stack.stop()
}
