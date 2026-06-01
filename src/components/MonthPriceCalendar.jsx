const WEEKDAYS = ['lu', 'ma', 'me', 'je', 've', 'sa', 'di']

const MONTH_INDEX_BY_NAME = {
  avril: 3,
  août: 7,
  décembre: 11,
  février: 1,
  janvier: 0,
  juillet: 6,
  juin: 5,
  mai: 4,
  mars: 2,
  novembre: 10,
  octobre: 9,
  septembre: 8,
}

function formatPrice(value) {
  return new Intl.NumberFormat('fr-FR', {
    currency: 'EUR',
    maximumFractionDigits: 2,
    style: 'currency',
  }).format(value)
}

function getMondayColumn(dateText) {
  const date = new Date(`${dateText}T00:00:00`)
  const day = date.getDay()

  return day === 0 ? 6 : day - 1
}

function getMonthIndex(month) {
  if (Number.isInteger(month.monthIndex)) return month.monthIndex

  return MONTH_INDEX_BY_NAME[month.monthName.toLowerCase()] ?? 0
}

function buildCalendarCells(month) {
  const monthIndex = getMonthIndex(month)
  const daysByNumber = new Map(month.days.map((day) => [day.day, day]))
  const daysInMonth = new Date(month.year, monthIndex + 1, 0).getDate()
  const firstDayColumn = getMondayColumn(
    `${month.year}-${String(monthIndex + 1).padStart(2, '0')}-01`,
  )
  const cells = Array.from({ length: firstDayColumn }, () => null)

  for (let dayNumber = 1; dayNumber <= daysInMonth; dayNumber += 1) {
    const date = [
      month.year,
      String(monthIndex + 1).padStart(2, '0'),
      String(dayNumber).padStart(2, '0'),
    ].join('-')

    cells.push(
      daysByNumber.get(dayNumber) ?? {
        calculatedPrice: 0,
        date,
        day: dayNumber,
        originalPrice: 0,
      },
    )
  }

  while (cells.length % 7 !== 0) {
    cells.push(null)
  }

  return cells
}

function MonthPriceCalendar({ month }) {
  const cells = buildCalendarCells(month)

  return (
    <article className="price-calendar-card">
      <h3>
        {month.monthName} {month.year}
      </h3>

      <table className="price-calendar">
        <thead>
          <tr>
            {WEEKDAYS.map((weekday) => (
              <th key={weekday}>{weekday}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: cells.length / 7 }).map((_, rowIndex) => (
            <tr key={rowIndex}>
              {cells.slice(rowIndex * 7, rowIndex * 7 + 7).map((day, index) => (
                <td key={`${rowIndex}-${index}`} className={day ? '' : 'empty'}>
                  {day && (
                    <div className="price-day">
                      <strong>{day.day}</strong>
                      <span>{formatPrice(day.calculatedPrice)}</span>
                    </div>
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </article>
  )
}

export default MonthPriceCalendar
