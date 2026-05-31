import { readFile } from 'node:fs/promises'

const ROOMS_FILE = new URL('../rooms.json', import.meta.url)
const ENV_FILE = new URL('../.env', import.meta.url)
const PARIS_TIME_ZONE = 'Europe/Paris'
const TELEGRAM_LIMIT = 3900

async function loadEnvFile() {
  let content

  try {
    content = await readFile(ENV_FILE, 'utf8')
  } catch {
    return
  }

  for (const line of content.split(/\r?\n/)) {
    const trimmedLine = line.trim()

    if (!trimmedLine || trimmedLine.startsWith('#') || !trimmedLine.includes('=')) {
      continue
    }

    const [rawKey, ...rawValueParts] = trimmedLine.split('=')
    const key = rawKey.trim()
    const value = rawValueParts.join('=').trim().replace(/^["']|["']$/g, '')

    if (key && process.env[key] === undefined) {
      process.env[key] = value
    }
  }
}

function normalizeCalendarUrl(url) {
  return String(url ?? '')
    .trim()
    .replace(/^webcal:\/\//i, 'https://')
}

function cleanText(value) {
  return String(value ?? '')
    .replace(/\\n/g, ' ')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\s+/g, ' ')
    .trim()
}

function unfoldIcal(text) {
  return text.replace(/\r?\n[ \t]/g, '')
}

function getIcalValue(line) {
  const index = line.indexOf(':')
  return index === -1 ? '' : line.slice(index + 1).trim()
}

function parseIcalDate(value) {
  if (!value) return null

  if (/^\d{8}$/.test(value)) {
    const year = Number(value.slice(0, 4))
    const month = Number(value.slice(4, 6)) - 1
    const day = Number(value.slice(6, 8))
    return new Date(year, month, day)
  }

  const match = value.match(
    /^(\d{4})(\d{2})(\d{2})T?(\d{2})?(\d{2})?(\d{2})?(Z)?/,
  )

  if (!match) return null

  const [, year, month, day, hour = '00', minute = '00', second = '00', utc] =
    match

  if (utc) {
    return new Date(
      Date.UTC(
        Number(year),
        Number(month) - 1,
        Number(day),
        Number(hour),
        Number(minute),
        Number(second),
      ),
    )
  }

  return new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
  )
}

function getPlatformLabel(calendar) {
  if (calendar.platform === 'Custom') {
    return calendar.customPlatform?.trim() || 'Custom'
  }

  return calendar.platform?.trim() || 'Unknown platform'
}

function classifyEvent(summary, description) {
  const text = `${summary} ${description}`.toLowerCase()

  if (
    text.includes('not available') ||
    text.includes('unavailable') ||
    text.includes('blocked') ||
    text.includes('closed')
  ) {
    return 'blocked'
  }

  return 'reservation'
}

function parseIcalEvents(icalText, room, calendar) {
  const unfolded = unfoldIcal(icalText)
  const blocks = unfolded.match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/g) ?? []

  return blocks
    .map((block) => {
      const fields = {}

      for (const line of block.split(/\r?\n/)) {
        const [rawKey] = line.split(':', 1)
        const key = rawKey.split(';')[0].toUpperCase()
        if (!fields[key]) fields[key] = getIcalValue(line)
      }

      const summary = cleanText(fields.SUMMARY)
      const description = cleanText(fields.DESCRIPTION)
      const start = parseIcalDate(fields.DTSTART)
      const end = parseIcalDate(fields.DTEND)

      if (!start || !end) return null

      return {
        id: fields.UID || `${fields.DTSTART}-${fields.DTEND}-${summary}`,
        roomName: room.name,
        platform: getPlatformLabel(calendar),
        type: classifyEvent(summary, description),
        start,
        end,
      }
    })
    .filter(Boolean)
}

function reservationsOverlap(a, b) {
  return a.start < b.end && b.start < a.end
}

function findConflictGroups(reservations) {
  const sortedReservations = [...reservations]
    .sort((a, b) => a.start - b.start)

  const visited = new Set()
  const groups = []

  for (let index = 0; index < sortedReservations.length; index += 1) {
    if (visited.has(index)) continue

    const groupIndexes = new Set()
    const stack = [index]

    while (stack.length > 0) {
      const currentIndex = stack.pop()
      if (groupIndexes.has(currentIndex)) continue

      groupIndexes.add(currentIndex)

      for (let otherIndex = 0; otherIndex < sortedReservations.length; otherIndex += 1) {
        if (
          otherIndex !== currentIndex &&
          reservationsOverlap(
            sortedReservations[currentIndex],
            sortedReservations[otherIndex],
          )
        ) {
          stack.push(otherIndex)
        }
      }
    }

    for (const groupIndex of groupIndexes) {
      visited.add(groupIndex)
    }

    if (groupIndexes.size > 1) {
      groups.push(
        [...groupIndexes]
          .map((groupIndex) => sortedReservations[groupIndex])
          .sort((a, b) => a.start - b.start),
      )
    }
  }

  return groups
}

function formatDate(date) {
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: '2-digit',
    timeZone: PARIS_TIME_ZONE,
    year: 'numeric',
  }).format(date)
}

function formatReportDate(date = new Date()) {
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: '2-digit',
    timeZone: PARIS_TIME_ZONE,
    year: 'numeric',
  }).format(date)
}

async function readRooms() {
  const content = await readFile(ROOMS_FILE, 'utf8')
  const data = JSON.parse(content)
  const rooms = Array.isArray(data) ? data : data.rooms

  if (!Array.isArray(rooms)) {
    throw new Error('rooms.json must contain a "rooms" array')
  }

  return rooms
}

async function fetchCalendar(url) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 20000)

  try {
    const response = await fetch(url, {
      headers: {
        Accept: 'text/calendar, text/plain, */*',
        'User-Agent': 'Gestion-Reservation/1.0 daily-check',
      },
      redirect: 'follow',
      signal: controller.signal,
    })

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error('HTTP 404 - calendar URL not found or expired')
      }

      throw new Error(`HTTP ${response.status}`)
    }

    return await response.text()
  } finally {
    clearTimeout(timeout)
  }
}

async function checkRooms(rooms) {
  const roomReports = []
  const fetchErrors = []

  for (const room of rooms) {
    const reservations = []

    for (const calendar of room.calendars ?? []) {
      const url = normalizeCalendarUrl(calendar.url)
      if (!url) continue

      try {
        const icalText = await fetchCalendar(url)
        reservations.push(...parseIcalEvents(icalText, room, calendar))
      } catch (error) {
        fetchErrors.push({
          roomName: room.name,
          platform: getPlatformLabel(calendar),
          message:
            error instanceof Error ? error.message : 'Unable to fetch calendar',
        })
      }
    }

    const conflictGroups = findConflictGroups(reservations)

    if (conflictGroups.length > 0) {
      roomReports.push({
        roomName: room.name,
        conflictGroups,
      })
    }
  }

  return {
    fetchErrors,
    roomReports,
  }
}

function buildReport({ roomReports, fetchErrors }) {
  const lines = []

  if (roomReports.length === 0) {
    lines.push('No conflict detected.')
  } else {
    lines.push(`Daily conflict report ${formatReportDate()}`)

    for (const roomReport of roomReports) {
      lines.push('')
      lines.push(`Room: ${roomReport.roomName}`)

      roomReport.conflictGroups.forEach((group, conflictIndex) => {
        lines.push(`Conflict ${conflictIndex + 1}:`)

        group.forEach((reservation, reservationIndex) => {
          lines.push(
            `Reservation ${reservationIndex + 1}: ${reservation.platform}, ` +
              `${formatDate(reservation.start)} -> ${formatDate(reservation.end)}`,
          )
        })
      })
    }
  }

  if (fetchErrors.length > 0) {
    lines.push('')
    lines.push('Calendar fetch problems:')

    for (const error of fetchErrors) {
      lines.push(`- ${error.roomName} / ${error.platform}: ${error.message}`)
    }
  }

  return lines.join('\n')
}

function splitMessage(text) {
  if (text.length <= TELEGRAM_LIMIT) return [text]

  const chunks = []
  let current = ''

  for (const line of text.split('\n')) {
    if (`${current}\n${line}`.length > TELEGRAM_LIMIT) {
      chunks.push(current)
      current = line
    } else {
      current = current ? `${current}\n${line}` : line
    }
  }

  if (current) chunks.push(current)

  return chunks
}

async function sendTelegramMessage(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN || process.env.telegram_bot_token
  const chatId = process.env.TELEGRAM_CHAT_ID || process.env.telegram_chat_id

  if (!token || !chatId) {
    throw new Error(
      'Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID environment variable',
    )
  }

  for (const chunk of splitMessage(text)) {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      body: JSON.stringify({
        chat_id: chatId,
        disable_web_page_preview: true,
        text: chunk,
      }),
      headers: {
        'Content-Type': 'application/json',
      },
      method: 'POST',
    })

    if (!response.ok) {
      const body = await response.text()

      if (body.toLowerCase().includes('chat not found')) {
        throw new Error(
          'Telegram chat not found. Use the numeric chat id, not @username. ' +
            'For local runs, put it in .env. For GitHub Actions, update the ' +
            'TELEGRAM_CHAT_ID repository secret.',
        )
      }

      throw new Error(`Telegram send failed: HTTP ${response.status} ${body}`)
    }
  }
}

async function main() {
  await loadEnvFile()

  const dryRun = process.argv.includes('--dry-run') || process.env.DRY_RUN === '1'
  const rooms = await readRooms()
  const report = buildReport(await checkRooms(rooms))

  console.log(report)

  if (dryRun) {
    console.log('\nDry run: Telegram message was not sent.')
    return
  }

  await sendTelegramMessage(report)
  console.log('\nTelegram message sent.')
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
