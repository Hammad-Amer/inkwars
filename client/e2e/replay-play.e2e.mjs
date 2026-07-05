import { chromium } from 'playwright'
import { assert, BASE, drawLine, inkBounds, startStack } from './harness.mjs'

/** A replay canvas is animating iff its ink count changes across samples. */
async function animates(page, selector) {
  const counts = new Set()
  for (let i = 0; i < 8; i++) {
    counts.add((await inkBounds(page, selector)).count)
    await page.waitForTimeout(350)
  }
  return counts.size > 1
}

const stack = await startStack()
const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  await page.goto(`${BASE}/play`)
  await page.click('text=Start match', { timeout: 30_000 }) // waits out model load
  await page.waitForSelector('canvas')
  await drawLine(page, { x: 0.3, y: 0.3 }, { x: 0.7, y: 0.6 })
  await page.click('text=Give up')
  await page.waitForSelector('.play-panel')
  assert((await page.locator('.play-panel .replay-canvas').count()) === 1, 'round-end panel shows a replay')
  assert(await animates(page, '.play-panel .replay-canvas'), 'round-end replay animates')
  // rounds 2-5: give up without drawing — empty rounds get no replay canvas
  for (let round = 2; round <= 5; round++) {
    await page.click('text=Next round')
    await page.waitForSelector('text=Give up')
    await page.click('text=Give up')
    if (round < 5) {
      await page.waitForSelector('.play-panel')
      if (round === 2) {
        assert(
          (await page.locator('.play-panel .replay-canvas').count()) === 0,
          'no replay when nothing was drawn',
        )
      }
    }
  }
  await page.waitForSelector('.play-summary')
  assert(
    (await page.locator('.play-summary .replay-canvas').count()) === 1,
    'recap shows a replay only for the drawn round',
  )
  assert(await animates(page, '.play-summary .replay-canvas'), 'recap replay animates')
  console.log('replay-play e2e: PASS')
} finally {
  await browser.close()
  stack.stop()
}
