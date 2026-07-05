import { assert, createAndJoin, drawLine, inkBounds, launchPair, startMatch, startStack } from './harness.mjs'

const stack = await startStack()
const { browser, a, b } = await launchPair()
try {
  await createAndJoin(a, b)
  await startMatch(a)
  assert((await a.locator('.chaos-banner').count()) === 0, 'chaos off: no banner')
  assert((await a.locator('.chaos-badge').count()) === 0, 'chaos off: no badge')
  await drawLine(a, { x: 0.3, y: 0.3 }, { x: 0.7, y: 0.7 })
  await a.waitForTimeout(600)
  const drawer = await inkBounds(a)
  const guesser = await inkBounds(b)
  assert(guesser.count > 50, 'strokes still relay')
  assert(Math.abs(drawer.minX - guesser.minX) < drawer.width * 0.1, 'no accidental transform on normal rounds')
  await b.fill('.chat-feed-input', 'zebra')
  await b.press('.chat-feed-input', 'Enter')
  await b.waitForSelector('.chat-feed-item:has-text("zebra")')
  assert(true, 'guessing still works')
  console.log('basic e2e: PASS')
} finally {
  await browser.close()
  stack.stop()
}
