import { assert, createAndJoin, drawLine, inkBounds, launchPair, startMatch, startStack } from './harness.mjs'

const stack = await startStack({ CHAOS_FORCE: 'mirror' })
const { browser, a, b } = await launchPair()
try {
  await createAndJoin(a, b)
  await startMatch(a)
  await a.waitForTimeout(3000) // let the chaos banner clear
  // Alice (round-1 drawer) draws a vertical line at the LEFT edge (x = 12%)
  await drawLine(a, { x: 0.12, y: 0.25 }, { x: 0.12, y: 0.75 })
  await a.waitForTimeout(600)
  const drawer = await inkBounds(a)
  const guesser = await inkBounds(b)
  assert(drawer.count > 50, 'drawer canvas has ink')
  assert(drawer.minX > drawer.width * 0.75, `drawer ink mirrored right (minX=${drawer.minX})`)
  assert(guesser.count > 50, 'guesser canvas has ink')
  assert(guesser.minX > guesser.width * 0.75, `guesser sees the mirrored stroke (minX=${guesser.minX})`)
  console.log('mirror e2e: PASS')
} finally {
  await browser.close()
  stack.stop()
}
