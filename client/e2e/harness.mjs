import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

/** Shared harness: spawns server+vite (port 5199), Playwright helpers. */

const clientDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const serverDir = path.resolve(clientDir, '..', 'server')
export const BASE = 'http://localhost:5199'

async function waitFor(url, timeoutMs = 40_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url)).ok) return
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error(`timed out waiting for ${url}`)
}

export async function startStack(env = {}) {
  const server = spawn(
    process.execPath,
    ['node_modules/tsx/dist/cli.mjs', 'src/index.ts'],
    { cwd: serverDir, env: { ...process.env, ...env }, stdio: 'inherit' },
  )
  const vite = spawn(
    process.execPath,
    ['node_modules/vite/bin/vite.js', '--port', '5199', '--strictPort'],
    { cwd: clientDir, stdio: 'inherit' },
  )
  await waitFor('http://localhost:3001/health')
  await waitFor(BASE)
  return {
    stop() {
      server.kill()
      vite.kill()
    },
  }
}

export async function launchPair() {
  const browser = await chromium.launch()
  return { browser, a: await browser.newPage(), b: await browser.newPage() }
}

export async function createAndJoin(a, b) {
  await a.goto(`${BASE}/rooms`)
  await a.fill('input[placeholder="doodle master"]', 'Alice')
  await a.click('text=Create a room')
  await a.waitForSelector('.room-lobby-code-value')
  const code = (await a.textContent('.room-lobby-code-value')).trim()
  await b.goto(`${BASE}/rooms/${code}`)
  await b.fill('input[placeholder="doodle master"]', 'Bob')
  await b.click('button:has-text("Join")')
  await b.waitForSelector('.room-lobby-players')
  return code
}

export async function startMatch(a) {
  await a.click('text=Start match')
  await a.waitForSelector('canvas')
}

/** Slow drag in canvas-fraction coords, so point timestamps spread out. */
export async function drawLine(page, from, to, steps = 30) {
  const box = await page.locator('canvas').first().boundingBox()
  const at = (f) => ({ x: box.x + box.width * f.x, y: box.y + box.height * f.y })
  const p0 = at(from)
  const p1 = at(to)
  await page.mouse.move(p0.x, p0.y)
  await page.mouse.down()
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(
      p0.x + ((p1.x - p0.x) * i) / steps,
      p0.y + ((p1.y - p0.y) * i) / steps,
    )
    await page.waitForTimeout(12)
  }
  await page.mouse.up()
}

/** Inked-pixel bounding box + count on the page's first canvas, CSS px. */
export async function inkBounds(page) {
  return page.locator('canvas').first().evaluate((canvas) => {
    const { width, height } = canvas
    const data = canvas.getContext('2d').getImageData(0, 0, width, height).data
    let minX = Infinity, minY = Infinity, maxX = -1, maxY = -1, count = 0
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4
        if (data[i + 3] > 100 && data[i] < 120) {
          count++
          if (x < minX) minX = x
          if (y < minY) minY = y
          if (x > maxX) maxX = x
          if (y > maxY) maxY = y
        }
      }
    }
    const dpr = window.devicePixelRatio || 1
    return {
      minX: minX / dpr, minY: minY / dpr, maxX: maxX / dpr, maxY: maxY / dpr,
      count, width: width / dpr, height: height / dpr,
    }
  })
}

export function assert(cond, msg) {
  if (!cond) throw new Error(`FAIL: ${msg}`)
  console.log(`ok — ${msg}`)
}
