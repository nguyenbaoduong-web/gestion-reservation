import { useEffect, useMemo, useState } from 'react'
import './App.css'

const STORAGE_KEY = 'gestion-reservation-rooms'

const PLATFORM_OPTIONS = ['Airbnb', 'Booking.com', 'Hotels.com', 'Custom']

const createCalendar = () => ({
  id: crypto.randomUUID(),
  platform: 'Airbnb',
  customPlatform: '',
  url: '',
})

const createRoom = (name = 'Room 1') => ({
  id: crypto.randomUUID(),
  name,
  calendars: [createCalendar()],
})

const defaultRooms = [
  createRoom('Appartement 0B'),
  createRoom('Appartement 1A'),
  createRoom('Appartement 1B'),
]

function normalizeSavedRooms(rooms) {
  return rooms.map((room) => ({
    ...room,
    name: room.name === 'Appartement 2A' ? 'Appartement 1B' : room.name,
  }))
}

function getPlatformLabel(calendar) {
  if (calendar.platform === 'Custom') {
    return calendar.customPlatform.trim() || 'Custom'
  }

  return calendar.platform
}

function normalizeCalendarUrl(url) {
  return url.trim().replace(/^webcal:\/\//i, 'https://')
}

function buildCalendarProxyUrl(url) {
  return `/api/ical?url=${encodeURIComponent(url)}`
}

function buildRoomsJson(rooms) {
  return JSON.stringify(
    {
      rooms: rooms.map((room) => ({
        name: room.name,
        calendars: room.calendars.map((calendar) => ({
          platform: getPlatformLabel(calendar),
          url: calendar.url,
        })),
      })),
    },
    null,
    2,
  )
}

function unfoldIcal(text) {
  return text.replace(/\r?\n[ \t]/g, '')
}

function getIcalValue(line) {
  const index = line.indexOf(':')
  return index === -1 ? '' : line.slice(index + 1).trim()
}

function cleanText(value) {
  return value
    .replace(/\\n/g, ' ')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\s+/g, ' ')
    .trim()
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

function findFirstMatch(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match?.[1]) return cleanText(match[1])
  }

  return ''
}

function guessReservationNumber(summary, description, uid) {
  const source = `${summary} ${description}`
  const found = findFirstMatch(source, [
    /reservation(?:\s+number)?\s*[:#-]?\s*([A-Z0-9-]{5,})/i,
    /booking(?:\s+number)?\s*[:#-]?\s*([A-Z0-9-]{5,})/i,
    /confirmation(?:\s+code)?\s*[:#-]?\s*([A-Z0-9-]{5,})/i,
    /\b(?:res|id)\s*[:#-]\s*([A-Z0-9-]{5,})/i,
  ])

  return found || uid || ''
}

function guessGuestName(summary, description) {
  const found = findFirstMatch(`${summary} ${description}`, [
    /guest\s*[:#-]\s*([^,;|]+)/i,
    /client\s*[:#-]\s*([^,;|]+)/i,
    /name\s*[:#-]\s*([^,;|]+)/i,
  ])

  if (found) return found

  const withoutReservedWords = summary
    .replace(/reserved|reservation|booking|blocked|busy/gi, '')
    .replace(/[-#:|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  return withoutReservedWords.length > 2 ? withoutReservedWords : ''
}

function parseIcalEvents(icalText, room, calendar) {
  const unfolded = unfoldIcal(icalText)
  const blocks = unfolded.match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/g) ?? []

  return blocks
    .map((block) => {
      const lines = block.split(/\r?\n/)
      const fields = {}

      for (const line of lines) {
        const [rawKey] = line.split(':', 1)
        const key = rawKey.split(';')[0].toUpperCase()
        if (!fields[key]) fields[key] = getIcalValue(line)
      }

      const summary = cleanText(fields.SUMMARY ?? '')
      const description = cleanText(fields.DESCRIPTION ?? '')
      const uid = cleanText(fields.UID ?? '')
      const start = parseIcalDate(fields.DTSTART)
      const end = parseIcalDate(fields.DTEND)

      if (!start || !end) return null

      return {
        id: `${calendar.id}-${uid || fields.DTSTART}-${fields.DTEND}`,
        roomId: room.id,
        roomName: room.name,
        platform: getPlatformLabel(calendar),
        reservationNumber: guessReservationNumber(summary, description, uid),
        guestName: guessGuestName(summary, description),
        start,
        end,
      }
    })
    .filter(Boolean)
}

function reservationsOverlap(a, b) {
  return a.start < b.end && b.start < a.end
}

function findConflictsByRoom(reservationsByRoom) {
  return reservationsByRoom
    .map(({ room, reservations }) => {
      const sortedReservations = [...reservations].sort((a, b) => a.start - b.start)
      const conflicts = []

      for (let i = 0; i < sortedReservations.length; i += 1) {
        for (let j = i + 1; j < sortedReservations.length; j += 1) {
          const current = sortedReservations[i]
          const next = sortedReservations[j]

          if (next.start >= current.end) break

          if (reservationsOverlap(current, next)) {
            conflicts.push({
              id: `${current.id}-${next.id}`,
              reservations: [current, next],
            })
          }
        }
      }

      return {
        room,
        conflicts,
      }
    })
    .filter((group) => group.conflicts.length > 0)
}

function formatDate(date) {
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date)
}

function App() {
  const [rooms, setRooms] = useState(() => {
    const savedRooms = localStorage.getItem(STORAGE_KEY)
    if (!savedRooms) return defaultRooms

    try {
      const parsedRooms = JSON.parse(savedRooms)
      return Array.isArray(parsedRooms) && parsedRooms.length > 0
        ? normalizeSavedRooms(parsedRooms)
        : defaultRooms
    } catch {
      return defaultRooms
    }
  })
  const [status, setStatus] = useState('idle')
  const [report, setReport] = useState(null)
  const [errors, setErrors] = useState([])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rooms))
  }, [rooms])

  const totalCalendars = useMemo(
    () => rooms.reduce((total, room) => total + room.calendars.length, 0),
    [rooms],
  )

  function updateRoom(roomId, changes) {
    setRooms((currentRooms) =>
      currentRooms.map((room) =>
        room.id === roomId ? { ...room, ...changes } : room,
      ),
    )
  }

  function addRoom() {
    setRooms((currentRooms) => [
      ...currentRooms,
      createRoom(`Room ${currentRooms.length + 1}`),
    ])
  }

  function deleteRoom(roomId) {
    setRooms((currentRooms) =>
      currentRooms.length === 1
        ? currentRooms
        : currentRooms.filter((room) => room.id !== roomId),
    )
  }

  function addCalendar(roomId) {
    setRooms((currentRooms) =>
      currentRooms.map((room) =>
        room.id === roomId
          ? { ...room, calendars: [...room.calendars, createCalendar()] }
          : room,
      ),
    )
  }

  function updateCalendar(roomId, calendarId, changes) {
    setRooms((currentRooms) =>
      currentRooms.map((room) =>
        room.id === roomId
          ? {
              ...room,
              calendars: room.calendars.map((calendar) =>
                calendar.id === calendarId
                  ? { ...calendar, ...changes }
                  : calendar,
              ),
            }
          : room,
      ),
    )
  }

  function deleteCalendar(roomId, calendarId) {
    setRooms((currentRooms) =>
      currentRooms.map((room) =>
        room.id === roomId
          ? {
              ...room,
              calendars:
                room.calendars.length === 1
                  ? room.calendars
                  : room.calendars.filter((calendar) => calendar.id !== calendarId),
            }
          : room,
      ),
    )
  }

  async function checkReservations() {
    setStatus('checking')
    setReport(null)
    setErrors([])

    const fetchErrors = []
    const reservationsByRoom = []

    for (const room of rooms) {
      const roomReservations = []

      for (const calendar of room.calendars) {
        const url = normalizeCalendarUrl(calendar.url)
        if (!url) continue

        try {
          const response = await fetch(buildCalendarProxyUrl(url))

          if (!response.ok) {
            let message = `HTTP ${response.status}`

            try {
              const data = await response.json()
              if (data?.error) message = data.error
            } catch {
              // Keep the generic HTTP message when the proxy returns non-JSON.
            }

            throw new Error(message)
          }

          const text = await response.text()
          roomReservations.push(...parseIcalEvents(text, room, calendar))
        } catch (error) {
          fetchErrors.push({
            roomName: room.name,
            platform: getPlatformLabel(calendar),
            message:
              error instanceof Error ? error.message : 'Unable to fetch calendar',
          })
        }
      }

      reservationsByRoom.push({
        room,
        reservations: roomReservations,
      })
    }

    setErrors(fetchErrors)
    setReport(findConflictsByRoom(reservationsByRoom))
    setStatus('done')
  }

  const hasRooms = rooms.length > 0
  const hasCalendarUrls = rooms.some((room) =>
    room.calendars.some((calendar) => calendar.url.trim()),
  )

  function downloadRoomsJson() {
    const blob = new Blob([buildRoomsJson(rooms)], {
      type: 'application/json',
    })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')

    link.href = url
    link.download = 'rooms.json'
    link.click()

    URL.revokeObjectURL(url)
  }

  return (
    <main className="app-shell">
      <header className="app-header">
        <div>
          <p className="eyebrow">Simple booking conflict checker</p>
          <h1>Gestion Reservation</h1>
          <p className="subtitle">
            Add your rooms, paste iCal links, then check if two bookings overlap
            in the same room.
          </p>
        </div>
        <div className="summary-box" aria-label="Current setup summary">
          <strong>{rooms.length}</strong>
          <span>{rooms.length === 1 ? 'room' : 'rooms'}</span>
          <strong>{totalCalendars}</strong>
          <span>{totalCalendars === 1 ? 'calendar' : 'calendars'}</span>
        </div>
      </header>

      <section className="toolbar" aria-label="Main actions">
        <button type="button" className="button secondary" onClick={addRoom}>
          + Add room
        </button>
        <div className="toolbar-actions">
          <button
            type="button"
            className="button secondary"
            disabled={!hasRooms}
            onClick={downloadRoomsJson}
          >
            Download rooms.json
          </button>
          <button
            type="button"
            className="button primary"
            disabled={status === 'checking' || !hasRooms || !hasCalendarUrls}
            onClick={checkReservations}
          >
            {status === 'checking' ? 'Checking...' : 'Check reservations'}
          </button>
        </div>
      </section>

      <section className="rooms" aria-label="Rooms">
        {rooms.map((room, roomIndex) => (
          <article className="room-card" key={room.id}>
            <div className="room-header">
              <label>
                <span>Room name</span>
                <input
                  value={room.name}
                  onChange={(event) =>
                    updateRoom(room.id, { name: event.target.value })
                  }
                  placeholder={`Room ${roomIndex + 1}`}
                />
              </label>
              <button
                type="button"
                className="button danger"
                disabled={rooms.length === 1}
                onClick={() => deleteRoom(room.id)}
              >
                Delete room
              </button>
            </div>

            <div className="calendar-list">
              {room.calendars.map((calendar) => (
                <div
                  className={`calendar-row ${
                    calendar.platform === 'Custom' ? 'custom' : ''
                  }`}
                  key={calendar.id}
                >
                  <label>
                    <span>Platform</span>
                    <select
                      value={calendar.platform}
                      onChange={(event) =>
                        updateCalendar(room.id, calendar.id, {
                          platform: event.target.value,
                        })
                      }
                    >
                      {PLATFORM_OPTIONS.map((platform) => (
                        <option key={platform} value={platform}>
                          {platform}
                        </option>
                      ))}
                    </select>
                  </label>

                  {calendar.platform === 'Custom' && (
                    <label>
                      <span>Custom name</span>
                      <input
                        value={calendar.customPlatform}
                        onChange={(event) =>
                          updateCalendar(room.id, calendar.id, {
                            customPlatform: event.target.value,
                          })
                        }
                        placeholder="Platform name"
                      />
                    </label>
                  )}

                  <label className="url-field">
                    <span>iCal URL</span>
                    <input
                      value={calendar.url}
                      onChange={(event) =>
                        updateCalendar(room.id, calendar.id, {
                          url: event.target.value,
                        })
                      }
                      placeholder="https://..."
                    />
                  </label>

                  <button
                    type="button"
                    className="icon-button"
                    disabled={room.calendars.length === 1}
                    onClick={() => deleteCalendar(room.id, calendar.id)}
                    aria-label={`Delete ${getPlatformLabel(calendar)} calendar`}
                    title="Delete calendar"
                  >
                    x
                  </button>
                </div>
              ))}
            </div>

            <button
              type="button"
              className="button small"
              onClick={() => addCalendar(room.id)}
            >
              + Add iCal link
            </button>
          </article>
        ))}
      </section>

      {errors.length > 0 && (
        <section className="notice warning" aria-live="polite">
          <h2>Calendar fetch problems</h2>
          <p>
            Some calendars could not be loaded. The report below uses only the
            calendars that were fetched successfully.
          </p>
          <ul>
            {errors.map((error) => (
              <li key={`${error.roomName}-${error.platform}-${error.message}`}>
                <strong>{error.roomName}</strong> - {error.platform}:{' '}
                {error.message}
              </li>
            ))}
          </ul>
        </section>
      )}

      {report && (
        <section className="report" aria-live="polite">
          <div className="report-header">
            <h2>Conflict report</h2>
            <span className={report.length > 0 ? 'status bad' : 'status good'}>
              {report.length > 0 ? 'Conflicts found' : 'No conflict detected'}
            </span>
          </div>

          {report.length === 0 ? (
            <p className="empty-state">No conflict detected</p>
          ) : (
            <div className="conflict-groups">
              {report.map((group) => (
                <article className="conflict-room" key={group.room.id}>
                  <h3>{group.room.name}</h3>
                  {group.conflicts.map((conflict, index) => (
                    <div className="conflict-card" key={conflict.id}>
                      <h4>Conflict {index + 1}</h4>
                      <div className="reservation-grid">
                        {conflict.reservations.map((reservation) => (
                          <div className="reservation" key={reservation.id}>
                            <dl>
                              <div>
                                <dt>Reservation</dt>
                                <dd>{reservation.reservationNumber || 'N/A'}</dd>
                              </div>
                              <div>
                                <dt>Platform</dt>
                                <dd>{reservation.platform}</dd>
                              </div>
                              <div>
                                <dt>Guest</dt>
                                <dd>{reservation.guestName || 'N/A'}</dd>
                              </div>
                              <div>
                                <dt>Check-in</dt>
                                <dd>{formatDate(reservation.start)}</dd>
                              </div>
                              <div>
                                <dt>Check-out</dt>
                                <dd>{formatDate(reservation.end)}</dd>
                              </div>
                            </dl>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </article>
              ))}
            </div>
          )}
        </section>
      )}
    </main>
  )
}

export default App
