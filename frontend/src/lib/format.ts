/**
 * Presentation-only formatting helpers.
 *
 * These never compute business values — they only render values the backend
 * returned (dates, counters, percentages derived from backend-provided counts).
 */

const dateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "short",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
})

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "short",
  day: "2-digit",
})

/** Format an ISO timestamp, tolerating null/invalid values. */
export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "—"
  return dateTimeFormatter.format(date)
}

/** Format an ISO date (or `YYYY-MM-DD`) without a time component. */
export function formatDate(value: string | null | undefined): string {
  if (!value) return "—"
  // Date-only strings are parsed as UTC; keep them stable across time zones.
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T00:00:00`)
    : new Date(value)
  if (Number.isNaN(date.getTime())) return "—"
  return dateFormatter.format(date)
}

/** `1000` → `1,000`. */
export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—"
  return new Intl.NumberFormat().format(value)
}

export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—"
  const rounded = Math.round(value * 10) / 10
  return `${rounded}%`
}

/** Title-case an enum-ish code such as `IN_PROGRESS` → `In progress`. */
export function humanize(value: string | null | undefined): string {
  if (!value) return "—"
  const lower = value.toLowerCase().replace(/_/g, " ")
  return lower.charAt(0).toUpperCase() + lower.slice(1)
}

/** Inclusive day count for a `YYYY-MM-DD` range; display-only. */
export function daysInRange(start: string, end: string): number {
  const startDate = new Date(`${start}T00:00:00`)
  const endDate = new Date(`${end}T00:00:00`)
  const diff = endDate.getTime() - startDate.getTime()
  if (Number.isNaN(diff) || diff < 0) return 0
  return Math.round(diff / 86_400_000) + 1
}

/** Today's local date as `YYYY-MM-DD` for date inputs. */
export function todayIso(): string {
  const now = new Date()
  const offset = now.getTimezoneOffset() * 60_000
  return new Date(now.getTime() - offset).toISOString().slice(0, 10)
}