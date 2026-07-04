import { chromium } from 'playwright'
import { assert, BASE, drawLine, inkBounds, startStack } from './harness.mjs'

const stack = await startStack()
const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  await page.goto(`${BASE}/play?chaos=mirror`)
  await page.click('text=Start match', { timeout: 30_000 }) // waits out model load
  await page.waitForSelector('canvas')
  await page.waitForTimeout(3000)
  await drawLine(page, { x: 0.12, y: 0.25 }, { x: 0.12, y: 0.75 })
  const ink = await inkBounds(page)
  assert(ink.count > 50, 'canvas has ink')
  assert(ink.minX > ink.width * 0.75, `ink mirrored right (minX=${ink.minX})`)
  assert(await page.locator('.chaos-badge').isVisible(), 'chaos badge on /play')
  console.log('play-chaos e2e: PASS')
} finally {
  await browser.close()
  stack.stop()
}
