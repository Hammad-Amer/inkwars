import { assert, createAndJoin, drawLine, inkBounds, launchPair, startMatch, startStack } from './harness.mjs'

/** A replay canvas is animating iff its ink count changes across samples. */
async function animates(page, selector) {
  const counts = new Set()
  for (let i = 0; i < 8; i++) {
    counts.add((await inkBounds(page, selector)).count)
    await page.waitForTimeout(350)
  }
  return counts.size > 1
}

const stack = await startStack({ ROUND_DURATION_MS: '4000' })
const { browser, a, b } = await launchPair()
try {
  await createAndJoin(a, b)
  await startMatch(a)
  // Alice (round-1 drawer) draws; the round times out at 4s
  await drawLine(a, { x: 0.3, y: 0.3 }, { x: 0.7, y: 0.6 })
  await a.waitForSelector('.room-panel', { timeout: 15_000 })
  assert((await a.locator('.room-panel .replay-canvas').count()) === 1, 'drawer sees the round replay')
  assert((await b.locator('.room-panel .replay-canvas').count()) === 1, 'guesser sees the round replay')
  assert(await animates(b, '.room-panel .replay-canvas'), 'guesser replay animates')
  for (const [page, who] of [[a, 'drawer'], [b, 'guesser']]) {
    const quip = await page.locator('.room-panel .machine-quip').textContent()
    assert(quip !== null && quip.length > 10, `${who} sees a MACHINE quip at round end`)
  }
  // nobody draws rounds 2-4; recap should hold exactly the one real drawing
  await a.waitForSelector('.room-summary', { timeout: 90_000 })
  assert((await a.locator('.room-summary .replay-canvas').count()) === 1, 'recap card only for the drawn round')
  assert(await animates(a, '.room-summary .replay-canvas'), 'recap replay animates')
  const analysisLines = await a.locator('.room-summary .machine-analysis li').count()
  assert(analysisLines >= 2 && analysisLines <= 4, 'match end shows a 2-4 line post-match analysis')
  console.log('replay-room e2e: PASS')
} finally {
  await browser.close()
  stack.stop()
}
