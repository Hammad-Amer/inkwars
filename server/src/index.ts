import express from 'express'

// Phase 0 skeleton: health check only. Socket.io room/game layer arrives in
// Phase 2/3 — see PROGRESS.md for the phase plan.
const app = express()
const port = Number(process.env.PORT ?? 3001)

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' })
})

app.listen(port, () => {
  console.log(`drawing-arena server listening on http://localhost:${port}`)
})
