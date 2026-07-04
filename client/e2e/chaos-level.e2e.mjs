import { assert, createAndJoin, launchPair, startStack } from './harness.mjs'

const stack = await startStack({ CHAOS_FORCE: 'mirror' })
const { browser, a, b } = await launchPair()
try {
  await createAndJoin(a, b)
  // host sees buttons; guest sees a readout
  assert((await a.locator('.chaos-level-btn').count()) === 3, 'host sees 3 chaos buttons')
  assert((await b.locator('.chaos-level-btn').count()) === 0, 'guest sees no buttons')
  await a.click('.chaos-level-btn:has-text("all")')
  await b.waitForSelector('.chaos-level-readout:has-text("all")')
  assert(true, 'guest lobby shows the new level')
  // forced modifier flows into the round meta → banner + badge on both clients
  await a.click('text=Start match')
  await a.waitForSelector('.chaos-banner')
  await b.waitForSelector('.chaos-banner')
  await a.waitForSelector('.chaos-badge')
  await b.waitForSelector('.chaos-badge')
  assert(true, 'banner and badge visible to drawer and guesser')
  console.log('chaos-level e2e: PASS')
} finally {
  await browser.close()
  stack.stop()
}
