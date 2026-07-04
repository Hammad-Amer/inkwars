import { assert, createAndJoin, drawLine, inkBounds, launchPair, startStack } from './harness.mjs'

// 12s draw window: enough for headless model load + two quick doodles
const stack = await startStack({ CHAOS_FORCE: 'simul', SIMUL_DRAW_MS: '12000' })
const { browser, a, b } = await launchPair()
try {
  await createAndJoin(a, b)
  await a.click('text=Start match')
  await a.waitForSelector('canvas')
  await b.waitForSelector('canvas')
  await a.waitForTimeout(3000)
  // both draw — privately (left half on A, right half on B)
  await drawLine(a, { x: 0.2, y: 0.3 }, { x: 0.2, y: 0.7 })
  await drawLine(b, { x: 0.8, y: 0.3 }, { x: 0.8, y: 0.7 })
  const bInk = await inkBounds(b)
  assert(bInk.maxX > bInk.width * 0.7 && bInk.minX > bInk.width * 0.5, 'B sees only its own ink (no relay)')
  // deadline → submissions → gallery
  await a.waitForSelector('.simul-grid', { timeout: 20_000 })
  await b.waitForSelector('.simul-grid')
  assert((await a.locator('.simul-entry').count()) === 2, 'gallery shows both drawings')
  assert((await a.locator('.chat-feed-item.is-ai').count()) >= 2, 'AI judged every canvas in the feed')
  // own vote button disabled; vote for each other
  assert(await a.locator('.simul-entry:has-text("(you)") .simul-vote-btn').isDisabled(), 'cannot vote for yourself')
  await a.locator('.simul-entry:not(:has-text("(you)")) .simul-vote-btn').click()
  await b.locator('.simul-entry:not(:has-text("(you)")) .simul-vote-btn').click()
  // all humans voted → early finish
  await a.waitForSelector('.room-panel:has-text("The votes are in")', { timeout: 10_000 })
  const panel = await a.locator('.room-panel').textContent()
  assert(panel.includes('+60') || panel.includes('+100') || panel.includes('+85'), 'vote points landed')
  console.log('simul e2e: PASS')
} finally {
  await browser.close()
  stack.stop()
}
