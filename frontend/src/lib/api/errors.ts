/**
 * Normalised API error handling.
 *
 * The backend uses one stable error envelope (see
 * `backend/common/exceptions.py`):
 *
 *   { "detail": "Human readable message", "errors": { "field": ["msg"] } }
 *
 * `ApiError` flattens that into something the UI can render directly, while
 * keeping the field errors for form-level display.
 */
import axios, { AxiosError } from "axios"

export interface ApiErrorPayload {
  detail?: unknown
  errors?: Record<string, unknown>
}

export class ApiError extends Error {
  readonly status: number
  /** Field → messages, ready to map onto form fields. */
  readonly fieldErrors: Record<string, string[]>
  /** Non-field message suitable for a toast/alert. */
  readonly detail: string
  readonly isNetworkError: boolean

  constructor(options: {
    message: string
    status: number
    fieldErrors?: Record<string, string[]>
    isNetworkError?: boolean
  }) {
    super(options.message)
    this.name = "ApiError"
    this.status = options.status
    this.detail = options.message
    this.fieldErrors = options.fieldErrors ?? {}
    this.isNetworkError = options.isNetworkError ?? false
  }

  get isForbidden(): boolean {
    return this.status === 403
  }

  get isNotFound(): boolean {
    return this.status === 404
  }

  get isUnauthorized(): boolean {
    return this.status === 401
  }

  get isConflict(): boolean {
    return this.status === 409
  }

  get isThrottled(): boolean {
    return this.status === 429
  }

  /** True when at least one form field carries a validation message. */
  get hasFieldErrors(): boolean {
    return Object.keys(this.fieldErrors).length > 0
  }
}

const GENERIC_MESSAGE = "Something went wrong. Please try again."
const NETWORK_MESSAGE =
  "The server could not be reached. Check your connection and try again."

/** DRF error values can be strings, arrays, or nested objects. */
function toStringArray(value: unknown): string[] {
  if (value === null || value === undefined) return []
  if (typeof value === "string") return [value]
  if (typeof value === "number" || typeof value === "boolean") {
    return [String(value)]
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => toStringArray(item))
  }
  if (typeof value === "object") {
    // DRF sometimes nests `{ "field": { "sub": ["message"] } }`.
    return Object.entries(value as Record<string, unknown>).flatMap(
      ([key, nested]) => {
        const messages = toStringArray(nested)
        return messages.length > 0 ? messages.map((m) => `${key}: ${m}`) : []
      },
    )
  }
  return []
}

function detailToMessage(value: unknown): string | null {
  if (typeof value === "string") return value
  const parts = toStringArray(value)
  return parts.length > 0 ? parts.join(" ") : null
}

/** Convert any thrown value into an `ApiError` the UI can rely on. */
export function normalizeError(error: unknown): ApiError {
  if (error instanceof ApiError) return error

  if (axios.isAxiosError(error)) {
    const axiosError = error as AxiosError<ApiErrorPayload>
    if (!axiosError.response) {
      return new ApiError({
        message: NETWORK_MESSAGE,
        status: 0,
        isNetworkError: true,
      })
    }

    const { status, data } = axiosError.response
    const fieldErrors: Record<string, string[]> = {}
    let detail: string | null = null

    if (data && typeof data === "object") {
      detail = detailToMessage(data.detail)
      if (data.errors && typeof data.errors === "object") {
        for (const [field, value] of Object.entries(data.errors)) {
          const messages = toStringArray(value)
          if (messages.length > 0) fieldErrors[field] = messages
        }
      } else {
        // No `errors` envelope: treat any sibling keys as field errors.
        for (const [field, value] of Object.entries(data)) {
          if (field === "detail") continue
          const messages = toStringArray(value)
          if (messages.length > 0) fieldErrors[field] = messages
        }
      }
    }

    if (!detail && Object.keys(fieldErrors).length > 0) {
      detail = "Please correct the highlighted fields."
    }

    return new ApiError({
      message: detail ?? fallbackMessageForStatus(status),
      status,
      fieldErrors,
    })
  }

  if (error instanceof Error) {
    return new ApiError({ message: error.message || GENERIC_MESSAGE, status: 0 })
  }

  return new ApiError({ message: GENERIC_MESSAGE, status: 0 })
}

function fallbackMessageForStatus(status: number): string {
  switch (status) {
    case 400:
      return "The request was rejected. Please review the values and try again."
    case 401:
      return "Your session has expired. Please sign in again."
    case 403:
      return "You do not have permission to perform this action."
    case 404:
      return "The requested record could not be found."
    case 409:
      return "This record is referenced elsewhere and cannot be changed."
    case 429:
      return "Too many attempts. Please wait a moment and try again."
    case 502:
    case 503:
      return "A dependent service is unavailable. Please try again shortly."
    default:
      return status >= 500
        ? "The server encountered an error. Please try again."
        : GENERIC_MESSAGE
  }
}

/** Human message for any error, for use in toasts and inline alerts. */
export function errorMessage(error: unknown): string {
  return normalizeError(error).detail
}
