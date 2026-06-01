import { useState } from 'react'
import MonthPriceCalendar from './MonthPriceCalendar.jsx'

function HotelPriceTracker() {
  const [bookingUrl, setBookingUrl] = useState('')
  const [coefficient, setCoefficient] = useState('0.8')
  const [status, setStatus] = useState('idle')
  const [error, setError] = useState('')
  const [months, setMonths] = useState([])

  async function runPriceSearch(event) {
    event.preventDefault()
    setStatus('loading')
    setError('')
    setMonths([])

    try {
      const response = await fetch('/api/hotel-prices', {
        body: JSON.stringify({
          bookingUrl,
          coefficient: Number(coefficient),
        }),
        headers: {
          'Content-Type': 'application/json',
        },
        method: 'POST',
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Unable to read Booking.com prices')
      }

      setMonths(data.months ?? [])
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
        <label>
          <span>Booking.com hotel URL</span>
          <input
            value={bookingUrl}
            onChange={(event) => setBookingUrl(event.target.value)}
            placeholder="https://www.booking.com/hotel/..."
            required
            type="url"
          />
        </label>

        <label>
          <span>Price coefficient</span>
          <input
            min="0.01"
            step="0.01"
            value={coefficient}
            onChange={(event) => setCoefficient(event.target.value)}
            placeholder="0.8"
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

      {months.length > 0 && (
        <section className="price-results" aria-live="polite">
          {months.map((month) => (
            <MonthPriceCalendar
              key={`${month.monthName}-${month.year}`}
              month={month}
            />
          ))}
        </section>
      )}
    </section>
  )
}

export default HotelPriceTracker
