import { useEffect, useState } from 'react'
import MonthPriceCalendar from './MonthPriceCalendar.jsx'

const TRACKER_STORAGE_KEY = 'gestion-reservation-hotel-price-tracker'
const HOTEL_COUNT = 3
const MONTH_COUNT = 4

function createDefaultHotels() {
  return Array.from({ length: HOTEL_COUNT }, (_, index) => ({
    id: `hotel-${index + 1}`,
    bookingUrl: '',
  }))
}

function loadSavedSettings() {
  const fallback = {
    coefficient: '1.0',
    hotels: createDefaultHotels(),
  }

  try {
    const saved = localStorage.getItem(TRACKER_STORAGE_KEY)
    if (!saved) return fallback

    const parsed = JSON.parse(saved)
    const savedHotels = Array.isArray(parsed.hotels) ? parsed.hotels : []

    return {
      coefficient: String(parsed.coefficient || '1.0'),
      hotels: createDefaultHotels().map((hotel, index) => ({
        ...hotel,
        bookingUrl: savedHotels[index]?.bookingUrl || '',
      })),
    }
  } catch {
    return fallback
  }
}

function getTodayDateText() {
  const today = new Date()

  return [
    today.getFullYear(),
    String(today.getMonth() + 1).padStart(2, '0'),
    String(today.getDate()).padStart(2, '0'),
  ].join('-')
}

function createEmptyHotelPrices() {
  return Array.from({ length: HOTEL_COUNT }, () => ({
    calculatedPrice: 0,
    originalPrice: 0,
  }))
}

function createMergedDay(day) {
  return {
    date: day.date,
    day: day.day,
    hotelPrices: createEmptyHotelPrices(),
    weekday: day.weekday,
  }
}

function mergeHotelResults(results) {
  const monthsByKey = new Map()

  for (const { data, hotelIndex } of results) {
    for (const month of data.months ?? []) {
      const monthKey = `${month.year}-${month.monthIndex}`

      if (!monthsByKey.has(monthKey)) {
        monthsByKey.set(monthKey, {
          days: [],
          monthIndex: month.monthIndex,
          monthName: month.monthName,
          year: month.year,
        })
      }

      const mergedMonth = monthsByKey.get(monthKey)
      const daysByNumber = new Map(
        mergedMonth.days.map((day) => [day.day, day]),
      )

      for (const day of month.days ?? []) {
        const mergedDay = daysByNumber.get(day.day) ?? createMergedDay(day)

        mergedDay.hotelPrices[hotelIndex] = {
          calculatedPrice: day.calculatedPrice || 0,
          originalPrice: day.originalPrice || 0,
        }

        if (!daysByNumber.has(day.day)) {
          daysByNumber.set(day.day, mergedDay)
          mergedMonth.days.push(mergedDay)
        }
      }

      mergedMonth.days.sort((a, b) => a.day - b.day)
    }
  }

  return [...monthsByKey.values()]
    .sort((a, b) => a.year - b.year || a.monthIndex - b.monthIndex)
    .slice(0, MONTH_COUNT)
}

function hasAnyVisiblePrice(data) {
  return data.months?.some((month) =>
    month.days?.some((day) => day.originalPrice > 0),
  )
}

async function fetchHotelPrices(hotel, coefficient, startDate, hotelIndex) {
  const response = await fetch('/api/hotel-prices', {
    body: JSON.stringify({
      bookingUrl: hotel.bookingUrl.trim(),
      coefficient,
      monthCount: MONTH_COUNT,
      startDate,
    }),
    headers: {
      'Content-Type': 'application/json',
    },
    method: 'POST',
  })

  const data = await response.json()

  if (!response.ok) {
    throw new Error(
      `Hotel ${hotelIndex + 1}: ${
        data.error || 'Unable to read Booking.com prices'
      }`,
    )
  }

  return data
}

function HotelPriceTracker() {
  const savedSettings = loadSavedSettings()
  const [hotels, setHotels] = useState(savedSettings.hotels)
  const [coefficient, setCoefficient] = useState(savedSettings.coefficient)
  const [status, setStatus] = useState('idle')
  const [error, setError] = useState('')
  const [warnings, setWarnings] = useState([])
  const [months, setMonths] = useState([])

  useEffect(() => {
    localStorage.setItem(
      TRACKER_STORAGE_KEY,
      JSON.stringify({
        coefficient,
        hotels,
      }),
    )
  }, [coefficient, hotels])

  function updateHotelUrl(hotelId, bookingUrl) {
    setHotels((currentHotels) =>
      currentHotels.map((hotel) =>
        hotel.id === hotelId ? { ...hotel, bookingUrl } : hotel,
      ),
    )
  }

  async function runPriceSearch(event) {
    event.preventDefault()
    setStatus('loading')
    setError('')
    setWarnings([])
    setMonths([])

    try {
      const numericCoefficient = Number(coefficient)

      if (!Number.isFinite(numericCoefficient) || numericCoefficient <= 0) {
        throw new Error('Price coefficient must be a positive number')
      }

      const startDate = getTodayDateText()
      const activeHotels = hotels
        .map((hotel, index) => ({ ...hotel, hotelIndex: index }))
        .filter((hotel) => hotel.bookingUrl.trim() !== '')

      if (activeHotels.length === 0) {
        throw new Error('Enter at least one Booking.com hotel URL')
      }

      const results = []
      const failedHotels = []

      for (const hotel of activeHotels) {
        try {
          const data = await fetchHotelPrices(
            hotel,
            numericCoefficient,
            startDate,
            hotel.hotelIndex,
          )

          results.push({
            data,
            hotelIndex: hotel.hotelIndex,
          })

          if (!hasAnyVisiblePrice(data)) {
            failedHotels.push(
              `Hotel ${hotel.hotelIndex + 1}: no visible prices were found; showing 0 €.`,
            )
          }
        } catch (hotelError) {
          failedHotels.push(
            hotelError instanceof Error
              ? hotelError.message
              : `Hotel ${hotel.hotelIndex + 1}: Unable to read prices`,
          )
        }
      }

      if (results.length === 0) {
        throw new Error(failedHotels.join(' '))
      }

      setMonths(mergeHotelResults(results))
      setWarnings(failedHotels)
      setStatus('done')
    } catch (priceError) {
      setError(
        priceError instanceof Error
          ? priceError.message
          : 'Unable to read Booking.com prices',
      )
      setStatus('error')
    }
  }

  const isLoading = status === 'loading'

  return (
    <section className="hotel-price-page" aria-labelledby="hotel-price-title">
      <header className="section-header">
        <p className="eyebrow">Booking.com prices</p>
        <h2 id="hotel-price-title">Hotel Price Tracker</h2>
      </header>

      <form className="price-search-form" onSubmit={runPriceSearch}>
        {hotels.map((hotel, index) => (
          <label key={hotel.id}>
            <span>Booking.com hotel URL {index + 1}</span>
            <input
              value={hotel.bookingUrl}
              onChange={(event) => updateHotelUrl(hotel.id, event.target.value)}
              placeholder="https://www.booking.com/hotel/..."
              type="url"
            />
          </label>
        ))}

        <label>
          <span>Price coefficient</span>
          <input
            min="0.01"
            step="0.01"
            value={coefficient}
            onChange={(event) => setCoefficient(event.target.value)}
            placeholder="1.0"
            required
            type="number"
          />
        </label>

        <button className="button primary" disabled={isLoading} type="submit">
          {isLoading ? 'Searching...' : 'Run price search'}
        </button>
      </form>

      {error && (
        <section className="notice warning" aria-live="polite">
          <h3>Price search failed</h3>
          <p>{error}</p>
        </section>
      )}

      {warnings.length > 0 && (
        <section className="notice warning" aria-live="polite">
          <h3>Some hotel prices could not be loaded</h3>
          <p>
            The table keeps the successful hotels. Failed or missing prices are
            shown as 0 €.
          </p>
          <ul>
            {warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </section>
      )}

      {months.length > 0 && (
        <section className="price-results" aria-live="polite">
          {months.map((month) => (
            <MonthPriceCalendar
              key={`${month.monthName}-${month.year}`}
              hotelCount={HOTEL_COUNT}
              month={month}
            />
          ))}
        </section>
      )}
    </section>
  )
}

export default HotelPriceTracker
