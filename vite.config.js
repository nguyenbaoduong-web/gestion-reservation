/* global document, MouseEvent, window */
import { readFile, writeFile } from 'node:fs/promises'
import { defineConfig } from 'vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'

const ROOMS_FILE = new URL('./rooms.json', import.meta.url)

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
      if (response.status === 404) {
        sendJson(res, 404, {
          error: 'Calendar URL not found or expired',
        })
        return
      }

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

async function handleRoomsConfig(req, res) {
  if (req.method === 'OPTIONS') {
    res.statusCode = 204
    res.end()
    return
  }

  if (!['GET', 'PUT'].includes(req.method)) {
    sendJson(res, 405, { error: 'Only GET and PUT requests are supported' })
    return
  }

  try {
    if (req.method === 'PUT') {
      const body = await readRequestBody(req)
      const rooms = Array.isArray(body) ? body : body.rooms

      if (!Array.isArray(rooms)) {
        sendJson(res, 400, { error: 'rooms.json must contain a rooms array' })
        return
      }

      const nextConfig = {
        rooms: rooms.map((room, roomIndex) => ({
          name: String(room.name || `Room ${roomIndex + 1}`).trim(),
          calendars: Array.isArray(room.calendars)
            ? room.calendars.map((calendar) => ({
                platform: String(calendar.platform || 'Custom').trim(),
                url: String(calendar.url || '').trim(),
              }))
            : [],
        })),
      }

      await writeFile(
        ROOMS_FILE,
        `${JSON.stringify(nextConfig, null, 2)}\n`,
        'utf8',
      )
      sendJson(res, 200, nextConfig)
      return
    }

    const content = await readFile(ROOMS_FILE, 'utf8')
    sendJson(res, 200, JSON.parse(content))
  } catch (error) {
    sendJson(res, 500, {
      error:
        error instanceof Error ? error.message : 'Unable to read rooms.json',
    })
  }
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = ''

    req.on('data', (chunk) => {
      body += chunk
    })

    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {})
      } catch {
        reject(new Error('Invalid JSON body'))
      }
    })

    req.on('error', reject)
  })
}

function validateBookingUrl(value) {
  let bookingUrl

  try {
    bookingUrl = new URL(value)
  } catch {
    throw new Error('Enter a valid Booking.com hotel URL')
  }

  if (!['http:', 'https:'].includes(bookingUrl.protocol)) {
    throw new Error('Booking.com URL must start with http or https')
  }

  if (!bookingUrl.hostname.includes('booking.com')) {
    throw new Error('Only Booking.com URLs are supported')
  }

  bookingUrl.pathname = bookingUrl.pathname.replace(
    /\.[a-z]{2}\.html$/i,
    '.fr.html',
  )
  bookingUrl.searchParams.set('lang', 'fr')
  bookingUrl.searchParams.set('selected_currency', 'EUR')

  return bookingUrl.toString()
}

function validateCoefficient(value) {
  const coefficient = Number(value)

  if (!Number.isFinite(coefficient) || coefficient <= 0) {
    throw new Error('Price coefficient must be a positive number')
  }

  return coefficient
}

function getTargetMonthFromBookingUrl(bookingUrl) {
  const url = new URL(bookingUrl)
  const checkin = url.searchParams.get('checkin')
  return getTargetMonthFromDateText(checkin)
}

function getTargetMonthFromDateText(value) {
  const checkin = String(value ?? '')
  const match = checkin?.match(/^(\d{4})-(\d{2})-\d{2}$/)

  if (!match) return null

  return {
    monthIndex: Number(match[2]) - 1,
    year: Number(match[1]),
  }
}

function getTargetMonth(bookingUrl, startDate) {
  return (
    getTargetMonthFromDateText(startDate) ||
    getTargetMonthFromBookingUrl(bookingUrl)
  )
}

function validateMonthCount(value) {
  const monthCount = Number(value ?? 2)

  if (!Number.isInteger(monthCount) || monthCount < 1 || monthCount > 6) {
    throw new Error('Month count must be between 1 and 6')
  }

  return monthCount
}

const serverWeekdays = ['di', 'lu', 'ma', 'me', 'je', 've', 'sa']

function getServerMonthName(monthIndex) {
  const monthName = new Intl.DateTimeFormat('fr-FR', {
    month: 'long',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(2026, monthIndex, 1)))

  return monthName.charAt(0).toUpperCase() + monthName.slice(1)
}

function createEmptyPriceDay(year, monthIndex, day, coefficient) {
  const date = new Date(Date.UTC(year, monthIndex, day))
  const dateText = [
    year,
    String(monthIndex + 1).padStart(2, '0'),
    String(day).padStart(2, '0'),
  ].join('-')

  return {
    calculatedPrice: 0,
    coefficient,
    date: dateText,
    day,
    originalPrice: 0,
    weekday: serverWeekdays[date.getUTCDay()],
  }
}

function completeServerMonthDays(month, coefficient) {
  const daysByNumber = new Map((month?.days ?? []).map((day) => [day.day, day]))
  const daysInMonth = new Date(month.year, month.monthIndex + 1, 0).getDate()
  const days = []

  for (let day = 1; day <= daysInMonth; day += 1) {
    days.push(
      daysByNumber.get(day) ??
        createEmptyPriceDay(month.year, month.monthIndex, day, coefficient),
    )
  }

  return days
}

function normalizeMonthSeries(months, targetMonth, monthCount, coefficient) {
  const now = new Date()
  const firstMonth = targetMonth ?? {
    monthIndex: now.getMonth(),
    year: now.getFullYear(),
  }
  const monthsByKey = new Map(
    months.map((month) => [`${month.year}-${month.monthIndex}`, month]),
  )
  const normalizedMonths = []

  for (let offset = 0; offset < monthCount; offset += 1) {
    const date = new Date(firstMonth.year, firstMonth.monthIndex + offset, 1)
    const year = date.getFullYear()
    const monthIndex = date.getMonth()
    const key = `${year}-${monthIndex}`
    const existingMonth = monthsByKey.get(key)
    const month = existingMonth ?? {
      days: [],
      monthIndex,
      monthName: getServerMonthName(monthIndex),
      year,
    }

    normalizedMonths.push({
      ...month,
      days: completeServerMonthDays(month, coefficient),
      monthIndex,
      monthName: getServerMonthName(monthIndex),
      year,
    })
  }

  return normalizedMonths
}

async function dismissCookieBanner(page) {
  const clickedVisibleButton = await page.evaluate(() => {
    function isVisibleInViewport(element) {
      const rect = element.getBoundingClientRect()
      const style = window.getComputedStyle(element)

      return (
        rect.width > 0 &&
        rect.height > 0 &&
        rect.bottom > 0 &&
        rect.top < window.innerHeight &&
        rect.right > 0 &&
        rect.left < window.innerWidth &&
        style.visibility !== 'hidden' &&
        style.display !== 'none'
      )
    }

    const cookieButton = [...document.querySelectorAll('button')]
      .filter(isVisibleInViewport)
      .find((button) =>
        /^(tout accepter|accepter|accept|refuser|reject|ok)$/i.test(
          (button.innerText || button.textContent || '').trim(),
        ),
      )

    if (!cookieButton) return false

    cookieButton.click()
    return true
  })

  if (clickedVisibleButton) {
    await page.waitForTimeout(600)
    return
  }

  const selectors = [
    'button:has-text("Accept")',
    'button:has-text("Accepter")',
    'button:has-text("Tout accepter")',
    'button:has-text("Refuser")',
    'button:has-text("OK")',
  ]

  for (const selector of selectors) {
    const button = page.locator(selector).first()

    try {
      if (await button.isVisible({ timeout: 800 })) {
        await button.click({ timeout: 1500 })
        return
      }
    } catch {
      // Cookie banners vary a lot; it is safe to continue if one selector fails.
    }
  }
}

async function scrollToAvailabilitySection(page) {
  const scrolled = await page.evaluate(() => {
    const target =
      document.querySelector(
        '#availability_target, #hp_availability_style_changes, #availability, #rooms_table',
      ) ||
      [...document.querySelectorAll('h2, section, div')].find((element) =>
        /disponibilit|availability/i.test(
          element.id || element.innerText || element.textContent || '',
        ),
      )

    if (!target) return false

    target.scrollIntoView({ block: 'start' })
    window.scrollBy(0, -80)
    return true
  })

  if (scrolled) {
    await page.waitForTimeout(800)
  }
}

async function getVisibleCalendarMonths(page) {
  return await page.evaluate(() => {
    const monthNames = {
      april: 3,
      août: 7,
      august: 7,
      avril: 3,
      décembre: 11,
      december: 11,
      février: 1,
      february: 1,
      janvier: 0,
      january: 0,
      juillet: 6,
      july: 6,
      juin: 5,
      june: 5,
      mai: 4,
      march: 2,
      mars: 2,
      may: 4,
      novembre: 10,
      november: 10,
      octobre: 9,
      october: 9,
      septembre: 8,
      september: 8,
    }
    const pattern = new RegExp(
      `\\b(${Object.keys(monthNames).join('|')})\\s+(20\\d{2})\\b`,
      'gi',
    )
    function isVisible(element) {
      const rect = element.getBoundingClientRect()
      const style = window.getComputedStyle(element)

      return (
        rect.width > 0 &&
        rect.height > 0 &&
        style.visibility !== 'hidden' &&
        style.display !== 'none'
      )
    }

    function collectMonthsFromText(text) {
      const seen = new Set()
      const months = []

      for (const match of text.matchAll(pattern)) {
        const monthIndex = monthNames[match[1].toLowerCase()]
        const year = Number(match[2])
        const key = `${year}-${monthIndex}`

        if (!seen.has(key)) {
          seen.add(key)
          months.push({ monthIndex, year })
        }
      }

      return months
    }

    const calendarTexts = [
      ...document.querySelectorAll(
        '[data-testid*="calendar"], [data-testid*="datepicker"], [role="dialog"], [role="grid"]',
      ),
    ]
      .filter(isVisible)
      .map((element) => element.innerText || element.textContent || '')
      .filter((text) => /\b(lu|ma|me|je|ve|sa|di)\b/i.test(text))

    for (const text of calendarTexts) {
      const months = collectMonthsFromText(text)
      if (months.length >= 2) return months.slice(0, 2)
    }

    return collectMonthsFromText(document.body.innerText).slice(0, 2)
  })
}

async function clickCalendarNext(page) {
  return await page.evaluate(() => {
    function isVisibleInViewport(element) {
      const rect = element.getBoundingClientRect()
      const style = window.getComputedStyle(element)

      return (
        rect.width > 0 &&
        rect.height > 0 &&
        rect.bottom > 0 &&
        rect.top < window.innerHeight &&
        rect.right > 0 &&
        rect.left < window.innerWidth &&
        style.visibility !== 'hidden' &&
        style.display !== 'none'
      )
    }

    const datepickerRoots = [
      ...document.querySelectorAll(
        '[data-testid="searchbox-datepicker"], [data-testid="searchbox-datepicker-calendar"], [data-testid*="calendar"]',
      ),
    ].filter(isVisibleInViewport)
    const dialogRoots = [...document.querySelectorAll('[role="dialog"]')]
      .filter(isVisibleInViewport)
      .filter((element) =>
        /\b(lu|ma|me|je|ve|sa|di)\b/i.test(
          element.innerText || element.textContent || '',
        ),
      )
    const roots = datepickerRoots.length > 0 ? datepickerRoots : dialogRoots
    const searchRoot = roots.length > 0 ? roots[0] : document
    const buttons = [...searchRoot.querySelectorAll('button')].filter(
      isVisibleInViewport,
    )
    const nextButton =
      buttons.find((button) =>
        /suivant|next|mois suivant|month/i.test(
          `${button.getAttribute('aria-label') || ''} ${button.title || ''}`,
        ),
      ) ||
      buttons
        .filter((button) => {
          const rect = button.getBoundingClientRect()
          return rect.top < 500 && rect.left > window.innerWidth * 0.55
        })
        .sort(
          (a, b) =>
            b.getBoundingClientRect().left - a.getBoundingClientRect().left,
        )[0]

    if (!nextButton) return false

    nextButton.click()
    return true
  })
}

async function moveCalendarToTargetMonth(page, targetMonth) {
  if (!targetMonth) return

  for (let attempt = 0; attempt < 18; attempt += 1) {
    const [firstMonth] = await getVisibleCalendarMonths(page)
    if (!firstMonth) return

    const currentValue = firstMonth.year * 12 + firstMonth.monthIndex
    const targetValue = targetMonth.year * 12 + targetMonth.monthIndex

    if (currentValue >= targetValue) return

    const clicked = await clickCalendarNext(page)
    if (!clicked) return

    await page.waitForTimeout(450)
  }
}

async function hasReadableCalendar(page, coefficient) {
  const result = await page.evaluate(extractVisibleHotelPrices, {
    coefficient,
    debug: false,
  })

  return result.months.length > 0
}

async function openAvailabilityCalendar(page, coefficient) {
  if (await hasReadableCalendar(page, coefficient)) return

  const clickedVisibleDateBox = await page.evaluate(() => {
    function isVisibleInViewport(element) {
      const rect = element.getBoundingClientRect()
      const style = window.getComputedStyle(element)

      return (
        rect.width > 0 &&
        rect.height > 0 &&
        rect.bottom > 0 &&
        rect.top < window.innerHeight &&
        rect.right > 0 &&
        rect.left < window.innerWidth &&
        style.visibility !== 'hidden' &&
        style.display !== 'none'
      )
    }

    const dateTextPattern =
      /(date d.arriv.e|date de d.part|check-in|check-out|dates|janv|f.vr|mars|avr|mai|juin|juil|ao.t|sept|oct|nov|d.c)/i
    const candidates = [
      ...document.querySelectorAll('button, [role="button"], div, span, input'),
    ]
      .filter(isVisibleInViewport)
      .map((element) => {
        const text = [
          element.getAttribute('aria-label'),
          element.getAttribute('placeholder'),
          element.textContent,
        ]
          .filter(Boolean)
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim()
        const rect = element.getBoundingClientRect()

        return { element, rect, text }
      })
      .filter(({ rect, text }) => {
        if (!dateTextPattern.test(text)) return false

        // Prefer compact controls instead of a whole page section.
        return rect.height <= 120 && rect.width <= 900
      })
      .sort((a, b) => {
        const aIsButton = a.element.closest('button, [role="button"]') ? 0 : 1
        const bIsButton = b.element.closest('button, [role="button"]') ? 0 : 1
        const buttonSort = aIsButton - bIsButton
        if (buttonSort !== 0) return buttonSort

        return a.rect.width * a.rect.height - b.rect.width * b.rect.height
      })

    const candidate = candidates[0]
    if (!candidate) return false

    const target =
      candidate.element.closest('button, [role="button"]') || candidate.element
    const rect = target.getBoundingClientRect()

    target.dispatchEvent(
      new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
      }),
    )

    return true
  })

  if (clickedVisibleDateBox) {
    await page.waitForTimeout(1200)
    if (await hasReadableCalendar(page, coefficient)) return
  }

  const selectors = [
    '[data-testid="date-display-field-start"]',
    '[data-testid="date-display-field-end"]',
    '[data-testid="searchbox-dates-container"]',
    'button[data-testid*="date"]',
    '[role="button"][data-testid*="date"]',
    '[data-testid*="date"] button',
    'button[aria-label*="date" i]',
    'button:has-text("Dates")',
    'button:has-text("Arrivée")',
    'button:has-text("Check-in")',
    'input[name*="checkin" i]',
  ]

  for (const selector of selectors) {
    const target = page.locator(selector).first()

    try {
      if (await target.isVisible({ timeout: 1000 })) {
        await target.click({ timeout: 2500 })
        await page.waitForTimeout(1200)
        if (await hasReadableCalendar(page, coefficient)) return
      }
    } catch {
      // Try the next simple selector. Do not force-click or bypass protection.
    }
  }

  // Booking.com often renders the date range as one large clickable box
  // with a calendar icon and text like "mar. 4 août — jeu. 6 août".
  const clickedDateBox = await page.evaluate(() => {
    function isVisible(element) {
      const rect = element.getBoundingClientRect()
      const style = window.getComputedStyle(element)

      return (
        rect.width > 0 &&
        rect.height > 0 &&
        rect.bottom > 0 &&
        rect.top < window.innerHeight &&
        rect.right > 0 &&
        rect.left < window.innerWidth &&
        style.visibility !== 'hidden' &&
        style.display !== 'none'
      )
    }

    const dateTextPattern =
      /(janv|févr|mars|avr|mai|juin|juil|août|sept|oct|nov|déc|check-in|arrivée|dates)/i

    for (const element of document.querySelectorAll('button, div, span, input')) {
      const text = [
        element.getAttribute('aria-label'),
        element.getAttribute('placeholder'),
        element.textContent,
      ]
        .filter(Boolean)
        .join(' ')

      if (isVisible(element) && dateTextPattern.test(text)) {
        const rect = element.getBoundingClientRect()
        element.dispatchEvent(
          new MouseEvent('click', {
            bubbles: true,
            cancelable: true,
            clientX: rect.left + rect.width / 2,
            clientY: rect.top + rect.height / 2,
          }),
        )
        return true
      }
    }

    return false
  })

  if (clickedDateBox) {
    await page.waitForTimeout(1200)
  }
}

async function assertNoProtectionPage(page) {
  const pageText = (await page.locator('body').innerText({ timeout: 5000 }))
    .toLowerCase()
    .slice(0, 6000)
  const currentUrl = page.url().toLowerCase()

  const blockedTexts = [
    'captcha',
    'robot',
    'unusual traffic',
    'verify you are human',
    'vérifiez que vous êtes humain',
  ]

  if (blockedTexts.some((text) => pageText.includes(text))) {
    throw new Error(
      'Booking.com is asking for verification or login. I cannot bypass that.',
    )
  }

  const looksLikeHotelPage =
    pageText.includes('disponibilité') ||
    pageText.includes('infos et tarifs') ||
    pageText.includes('voir les tarifs')
  const looksLikeLoginPage =
    currentUrl.includes('sign-in') ||
    currentUrl.includes('login') ||
    (pageText.includes('connectez-vous à votre compte') &&
      pageText.includes('adresse e-mail')) ||
    (pageText.includes('sign in') && pageText.includes('email address'))

  if (looksLikeLoginPage && !looksLikeHotelPage) {
    throw new Error(
      'Booking.com is asking for verification or login. I cannot bypass that.',
    )
  }
}

function extractVisibleHotelPrices({ coefficient, debug }) {
  const monthNames = {
    april: 3,
    août: 7,
    august: 7,
    avril: 3,
    décembre: 11,
    december: 11,
    février: 1,
    february: 1,
    janvier: 0,
    january: 0,
    juillet: 6,
    july: 6,
    juin: 5,
    june: 5,
    mai: 4,
    march: 2,
    mars: 2,
    may: 4,
    novembre: 10,
    november: 10,
    octobre: 9,
    october: 9,
    septembre: 8,
    september: 8,
  }
  const monthLabels = [
    'Janvier',
    'Février',
    'Mars',
    'Avril',
    'Mai',
    'Juin',
    'Juillet',
    'Août',
    'Septembre',
    'Octobre',
    'Novembre',
    'Décembre',
  ]
  const weekdays = ['di', 'lu', 'ma', 'me', 'je', 've', 'sa']
  const normalizedMonthNames = Object.keys(monthNames).join('|')
  const monthTitlePattern = new RegExp(
    `\\b(${normalizedMonthNames})\\s+(20\\d{2})\\b`,
    'i',
  )

  function cleanText(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim()
  }

  function isVisible(element) {
    const rect = element.getBoundingClientRect()
    const style = window.getComputedStyle(element)

    return (
      rect.width > 0 &&
      rect.height > 0 &&
      style.visibility !== 'hidden' &&
      style.display !== 'none'
    )
  }

  function parsePrice(text) {
    const priceMatch =
      text.match(/(?:€|EUR)\s*([0-9][0-9\s.,]*)/i) ||
      text.match(/([0-9][0-9\s.,]*)\s*(?:€|EUR)/i)

    if (!priceMatch) return null

    const rawPrice = priceMatch[1].replace(/\s/g, '')
    const normalizedPrice = rawPrice.includes(',') && !rawPrice.includes('.')
      ? rawPrice.replace(',', '.')
      : rawPrice.replace(/,/g, '')
    const price = Number(normalizedPrice)

    return Number.isFinite(price) ? price : null
  }

  function parsePrices(text) {
    const prices = []
    const pricePattern = /(?:€|EUR)\s*([0-9][0-9\s.,]*)|([0-9][0-9\s.,]*)\s*(?:€|EUR)/gi

    for (const match of text.matchAll(pricePattern)) {
      const rawValue = (match[1] || match[2] || '').replace(/\s/g, '')
      const normalizedValue = rawValue.includes(',') && !rawValue.includes('.')
        ? rawValue.replace(',', '.')
        : rawValue.replace(/,/g, '')
      const price = Number(normalizedValue)

      if (Number.isFinite(price)) prices.push(price)
    }

    return prices
  }

  function parseDay(text, element) {
    const label = cleanText(
      element.getAttribute('aria-label') ||
        element.getAttribute('title') ||
        element.textContent,
    )
    const dayFromLabel = label.match(/\b([1-9]|[12]\d|3[01])\b/)

    if (dayFromLabel) return Number(dayFromLabel[1])

    const priceIndex = text.search(/€|EUR/i)
    const beforePrice = priceIndex >= 0 ? text.slice(0, priceIndex) : text
    const dayFromText = beforePrice.match(/\b([1-9]|[12]\d|3[01])\b/)

    return dayFromText ? Number(dayFromText[1]) : null
  }

  function findMonthTitle(text) {
    const match = text.match(monthTitlePattern)
    if (!match) return null

    const monthIndex = monthNames[match[1].toLowerCase()]
    const year = Number(match[2])

    if (monthIndex === undefined || !Number.isFinite(year)) return null

    return {
      monthIndex,
      monthName: monthLabels[monthIndex],
      title: `${monthLabels[monthIndex]} ${year}`,
      year,
    }
  }

  function buildDay(month, day, originalPrice) {
    const date = new Date(month.year, month.monthIndex, day)

    if (
      date.getFullYear() !== month.year ||
      date.getMonth() !== month.monthIndex
    ) {
      return null
    }

    const isoDate = [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0'),
    ].join('-')

    return {
      calculatedPrice: Number((originalPrice * coefficient).toFixed(2)),
      coefficient,
      date: isoDate,
      day,
      originalPrice,
      weekday: weekdays[date.getDay()],
    }
  }

  function completeMonthDays(month, pricedDays) {
    const daysByNumber = new Map(pricedDays.map((day) => [day.day, day]))
    const daysInMonth = new Date(month.year, month.monthIndex + 1, 0).getDate()
    const days = []

    for (let day = 1; day <= daysInMonth; day += 1) {
      days.push(daysByNumber.get(day) ?? buildDay(month, day, 0))
    }

    return days.filter(Boolean)
  }

  function hasVisiblePrices(days) {
    return days.some((day) => day.originalPrice > 0)
  }

  function findDayElements(container) {
    const selectors = [
      '[role="gridcell"]',
      'td',
      'button',
      '[data-testid*="date"]',
      '[data-testid*="day"]',
    ]

    return [...container.querySelectorAll(selectors.join(','))].filter((element) =>
      isVisible(element),
    )
  }

  function parseMonthChunk(month, chunk) {
    const calendarEndPatterns = [
      /tarifs approximatifs/i,
      /date d.arriv.e\s*-\s*date de d.part/i,
      /type de logement/i,
      /nombre de voyageurs/i,
      /voir les tarifs/i,
      /voir les disponibilit/i,
    ]
    const calendarEndIndex = calendarEndPatterns
      .map((pattern) => chunk.search(pattern))
      .filter((index) => index > 0)
      .sort((a, b) => a - b)[0]
    const calendarChunk =
      calendarEndIndex === undefined ? chunk : chunk.slice(0, calendarEndIndex)

    if (calendarChunk.length > 2600) return []

    const lines = calendarChunk
      .split('\n')
      .map(cleanText)
      .filter(Boolean)
      .filter((line) => !/^(lu|ma|me|je|ve|sa|di)$/i.test(line))
    const daysByDate = new Map()

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]
      const dayMatches = [...line.matchAll(/\b([1-9]|[12]\d|3[01])\b/g)]
      if (dayMatches.length === 0) continue

      const sameLinePrices = parsePrices(line)
      const nextLinePrices = parsePrices(lines[index + 1] || '')

      dayMatches.forEach((match, dayIndex) => {
        const day = Number(match[1])
        const originalPrice =
          sameLinePrices[dayIndex] ?? nextLinePrices[dayIndex] ?? 0
        const parsedDay = buildDay(month, day, originalPrice)

        if (!parsedDay) return

        const existingDay = daysByDate.get(parsedDay.date)
        if (existingDay?.originalPrice > 0 && parsedDay.originalPrice === 0) {
          return
        }

        daysByDate.set(parsedDay.date, parsedDay)
      })
    }

    return completeMonthDays(month, [...daysByDate.values()])
  }

  function getMonthTitleMatches(text) {
    return [...text.matchAll(new RegExp(monthTitlePattern, 'gi'))]
  }

  function parseMonthsFromVisibleText(text, maxMonths = 2) {
    const matches = [...text.matchAll(new RegExp(monthTitlePattern, 'gi'))]
    const months = []

    for (let index = 0; index < matches.length; index += 1) {
      const match = matches[index]
      const month = findMonthTitle(match[0])
      if (!month) continue

      const nextMatch = matches[index + 1]
      const chunk = text.slice(match.index, nextMatch?.index ?? text.length)
      const days = parseMonthChunk(month, chunk)

      months.push({
        days,
        monthIndex: month.monthIndex,
        monthName: month.monthName,
        year: month.year,
      })

      if (months.length >= maxMonths) break
    }

    return months
  }

  const rawVisibleText = document.body.innerText.slice(0, 12000)
  const cleanedVisibleText = cleanText(rawVisibleText)
  const monthsByTitle = new Map()

  function rememberMonth(month, days) {
    if (days.length === 0) return

    const existingMonth = monthsByTitle.get(month.title)

    if (existingMonth && hasVisiblePrices(existingMonth.days)) return

    monthsByTitle.set(month.title, {
      days,
      monthIndex: month.monthIndex,
      monthName: month.monthName,
      year: month.year,
    })
  }

  const candidates = [
    ...document.querySelectorAll(
      '[data-testid*="month"], [data-testid*="calendar"], [role="grid"], table, section, div',
    ),
  ]
    .filter(isVisible)
    .map((element) => ({
      element,
      text: cleanText(element.innerText),
    }))
    .filter(
      ({ text }) =>
        monthTitlePattern.test(text) &&
        (/€|EUR/i.test(text) || /\b(lu|ma|me|je|ve|sa|di)\b/i.test(text)),
    )
    .sort((a, b) => a.text.length - b.text.length)

  for (const candidate of candidates) {
    if (monthsByTitle.size >= 2) break

    const parsedMonths = parseMonthsFromVisibleText(candidate.element.innerText)

    for (const parsedMonth of parsedMonths) {
      const month = {
        monthIndex: parsedMonth.monthIndex,
        monthName: parsedMonth.monthName,
        title: `${parsedMonth.monthName} ${parsedMonth.year}`,
        year: parsedMonth.year,
      }

      const existingMonth = monthsByTitle.get(month.title)
      if (existingMonth && hasVisiblePrices(existingMonth.days)) continue

      let days = parsedMonth.days

      // Only use direct DOM cell fallback when this candidate contains one
      // month. Multi-month containers can mix the next month's days/prices.
      if (!hasVisiblePrices(days) && getMonthTitleMatches(candidate.text).length === 1) {
        const daysByDate = new Map()

        for (const element of findDayElements(candidate.element)) {
          const text = cleanText(element.innerText || element.textContent)
          const originalPrice = parsePrice(text)
          if (!originalPrice) continue

          const day = parseDay(text, element)
          if (!day) continue

          const parsedDay = buildDay(month, day, originalPrice)

          if (parsedDay) daysByDate.set(parsedDay.date, parsedDay)
        }

        days = completeMonthDays(month, [...daysByDate.values()])
      }

      rememberMonth(month, days)

      if (monthsByTitle.size >= 2) break
    }

    if (monthsByTitle.size >= 2) break
  }

  for (const month of parseMonthsFromVisibleText(rawVisibleText)) {
    rememberMonth(
      {
        monthIndex: month.monthIndex,
        monthName: month.monthName,
        title: `${month.monthName} ${month.year}`,
        year: month.year,
      },
      month.days,
    )

    if (monthsByTitle.size >= 2) break
  }

  return {
    months: [...monthsByTitle.values()]
      .sort((a, b) => a.year - b.year || a.monthIndex - b.monthIndex)
      .slice(0, 2),
    rawVisibleText: debug ? cleanedVisibleText : '',
  }
}

async function extractMonthsFromCalendar(page, coefficient, debug, monthCount) {
  const monthsByKey = new Map()
  const rawTexts = []

  for (let attempt = 0; attempt < monthCount; attempt += 1) {
    const result = await page.evaluate(extractVisibleHotelPrices, {
      coefficient,
      debug,
    })

    if (debug && result.rawVisibleText) {
      rawTexts.push(result.rawVisibleText)
    }

    for (const month of result.months) {
      const key = `${month.year}-${month.monthIndex}`

      if (!monthsByKey.has(key)) {
        monthsByKey.set(key, month)
      }
    }

    if (monthsByKey.size >= monthCount) break

    const clicked = await clickCalendarNext(page)
    if (!clicked) break

    await page.waitForTimeout(700)
  }

  return {
    months: [...monthsByKey.values()]
      .sort((a, b) => a.year - b.year || a.monthIndex - b.monthIndex)
      .slice(0, monthCount),
    rawVisibleText: rawTexts.join('\n\n--- next calendar page ---\n\n'),
  }
}

async function readHotelPrices(
  bookingUrl,
  coefficient,
  debug,
  { monthCount = 2, startDate } = {},
) {
  const { chromium } = await import('playwright')
  const targetMonth = getTargetMonth(bookingUrl, startDate)
  let browser

  try {
    browser = await chromium.launch({ headless: true })
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.toLowerCase().includes('executable')
    ) {
      throw new Error(
        'Playwright browser is missing. Run: npx playwright install chromium',
        { cause: error },
      )
    }

    throw error
  }

  try {
    const context = await browser.newContext({
      locale: 'fr-FR',
      timezoneId: 'Europe/Paris',
      viewport: { height: 900, width: 1280 },
    })
    const page = await context.newPage()

    await page.goto(bookingUrl, {
      timeout: 60000,
      waitUntil: 'domcontentloaded',
    })
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {})
    await dismissCookieBanner(page)
    await assertNoProtectionPage(page)
    await scrollToAvailabilitySection(page)
    await dismissCookieBanner(page)
    await openAvailabilityCalendar(page, coefficient)
    await moveCalendarToTargetMonth(page, targetMonth)
    await assertNoProtectionPage(page)

    let result = await extractMonthsFromCalendar(
      page,
      coefficient,
      debug,
      monthCount,
    )

    if (result.months.length === 0) {
      await dismissCookieBanner(page)
      await openAvailabilityCalendar(page, coefficient)
      await page.waitForTimeout(1500)
      await assertNoProtectionPage(page)

      result = await extractMonthsFromCalendar(
        page,
        coefficient,
        debug,
        monthCount,
      )
    }

    if (debug && result.rawVisibleText) {
      console.log('Raw visible Booking.com calendar text:')
      console.log(result.rawVisibleText)
    }

    if (result.months.length === 0) {
      throw new Error(
        'No visible calendar prices were found. Open the calendar manually or try another Booking.com hotel URL.',
      )
    }

    return {
      ...result,
      months: normalizeMonthSeries(
        result.months,
        targetMonth,
        monthCount,
        coefficient,
      ),
    }
  } finally {
    await browser.close()
  }
}

async function handleHotelPrices(req, res) {
  if (req.method === 'OPTIONS') {
    res.statusCode = 204
    res.end()
    return
  }

  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Only POST requests are supported' })
    return
  }

  try {
    const body = await readRequestBody(req)
    const bookingUrl = validateBookingUrl(body.bookingUrl)
    const coefficient = validateCoefficient(body.coefficient)
    const monthCount = validateMonthCount(body.monthCount)
    const result = await readHotelPrices(
      bookingUrl,
      coefficient,
      body.debug === true || process.env.DEBUG_HOTEL_PRICES === '1',
      {
        monthCount,
        startDate: body.startDate,
      },
    )

    sendJson(res, 200, result)
  } catch (error) {
    sendJson(res, 400, {
      error:
        error instanceof Error
          ? error.message
          : 'Unable to read Booking.com prices',
    })
  }
}

function icalProxyPlugin() {
  return {
    name: 'gestion-reservation-ical-proxy',
    configureServer(server) {
      server.middlewares.use('/api/rooms', handleRoomsConfig)
      server.middlewares.use('/api/ical', handleIcalProxy)
      server.middlewares.use('/api/hotel-prices', handleHotelPrices)
    },
    configurePreviewServer(server) {
      server.middlewares.use('/api/rooms', handleRoomsConfig)
      server.middlewares.use('/api/ical', handleIcalProxy)
      server.middlewares.use('/api/hotel-prices', handleHotelPrices)
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
