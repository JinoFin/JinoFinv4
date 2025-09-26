import dayjs from 'dayjs'

export function normalizeAmountString(val) {
  if (val == null) return ''
  let v = String(val).trim().replace(/\s/g, '')
  const hasComma = v.includes(',')
  const hasDot = v.includes('.')
  if (hasComma && hasDot) v = v.replace(/\./g, '').replace(',', '.')
  else v = v.replace(',', '.')
  v = v.replace(/[^0-9.\-]/g, '')
  const parts = v.split('.')
  if (parts.length > 2) v = parts.shift() + '.' + parts.join('')
  return v
}

export function parseAmountNumber(val) {
  const normalized = normalizeAmountString(val)
  const num = parseFloat(normalized)
  return Number.isFinite(num) ? num : NaN
}

export function formatCurrency(value, currency, opts = {}) {
  if (!Number.isFinite(value)) return '—'
  const formatter = new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: currency || 'EUR',
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
    ...opts,
  })
  return formatter.format(value)
}

export function monthRangeISO(monthKey) {
  const start = dayjs(monthKey + '-01').startOf('day').toISOString()
  const end = dayjs(monthKey).endOf('month').endOf('day').toISOString()
  return { start, end }
}
