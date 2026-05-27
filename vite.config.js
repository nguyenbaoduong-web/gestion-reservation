import { defineConfig } from 'vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'

function sendJson(res, statusCode, body) {
  res.statusCode = statusCode
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(body))
}

async function handleIcalProxy(req, res) {
  if (req.method === 'OPTIONS') {
    res.statusCode = 204
    res.end()
    return
  }

  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'Only GET requests are supported' })
    return
  }

  const requestUrl = new URL(req.url ?? '', 'http://localhost')
  const target = requestUrl.searchParams.get('url')

  if (!target) {
    sendJson(res, 400, { error: 'Missing iCal URL' })
    return
  }

  let calendarUrl

  try {
    calendarUrl = new URL(target)
  } catch {
    sendJson(res, 400, { error: 'Invalid iCal URL' })
    return
  }

  if (!['http:', 'https:'].includes(calendarUrl.protocol)) {
    sendJson(res, 400, { error: 'Only http and https iCal URLs are supported' })
    return
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 20000)

  try {
    const response = await fetch(calendarUrl, {
      headers: {
        Accept: 'text/calendar, text/plain, */*',
        'User-Agent': 'Gestion-Reservation/1.0 local iCal checker',
      },
      redirect: 'follow',
      signal: controller.signal,
    })

    if (!response.ok) {
      sendJson(res, response.status, {
        error: `Calendar server returned HTTP ${response.status}`,
      })
      return
    }

    const calendarText = await response.text()

    res.statusCode = 200
    res.setHeader(
      'Content-Type',
      response.headers.get('content-type') || 'text/calendar; charset=utf-8',
    )
    res.setHeader('Cache-Control', 'no-store')
    res.end(calendarText)
  } catch (error) {
    sendJson(res, error?.name === 'AbortError' ? 504 : 502, {
      error:
        error instanceof Error ? error.message : 'Unable to fetch iCal calendar',
    })
  } finally {
    clearTimeout(timeout)
  }
}

function icalProxyPlugin() {
  return {
    name: 'gestion-reservation-ical-proxy',
    configureServer(server) {
      server.middlewares.use('/api/ical', handleIcalProxy)
    },
    configurePreviewServer(server) {
      server.middlewares.use('/api/ical', handleIcalProxy)
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    icalProxyPlugin(),
    react(),
    babel({ presets: [reactCompilerPreset()] }),
  ],
})
