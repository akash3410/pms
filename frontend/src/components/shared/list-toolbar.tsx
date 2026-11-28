import { Search, X } from "lucide-react"
import * as React from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"

/** Debounced search box. Calls `onChange` after the user pauses typing. */
export function SearchInput({
  value,
  onChange,
  placeholder = "Search…",
  delay = 300,
  className,
  label = "Search",
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  delay?: number
  className?: string
  label?: string
}) {
  const [draft, setDraft] = React.useState(value)

  // Keep the field in sync when the parent resets filters.
  React.useEffect(() => {
    setDraft(value)
  }, [value])

  React.useEffect(() => {
    if (draft === value) return
    const timer = window.setTimeout(() => onChange(draft), delay)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, delay])

  return (
    <div className={cn("relative w-full sm:max-w-xs", className)}>
      <Search
        className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden="true"
      />
      <Input
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        placeholder={placeholder}
        aria-label={label}
        className="pr-8 pl-9"
      />
      {draft ? (
        <button
          type="button"
          onClick={() => {
            setDraft("")
            onChange("")
          }}
          className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
          aria-label="Clear search"
        >
          <X className="size-3.5" />
        </button>
      ) : null}
    </div>
  )
}

export const ALL_VALUE = "__all__"

/** A filter dropdown that can express "no filter" (Radix forbids empty values). */
export function FilterSelect({
  value,
  onChange,
  options,
  placeholder,
  allLabel = "All",
  className,
  label,
}: {
  value: string | undefined
  onChange: (value: string | undefined) => void
  options: { value: string; label: string }[]
  placeholder: string
  allLabel?: string
  className?: string
  label: string
}) {
  return (
    <Select
      value={value ?? ALL_VALUE}
      onValueChange={(next) => onChange(next === ALL_VALUE ? undefined : next)}
    >
      <SelectTrigger
        className={cn("w-full sm:w-[170px]", className)}
        aria-label={label}
      >
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL_VALUE}>{allLabel}</SelectItem>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export function Toolbar({
  children,
  actions,
  className,
}: {
  children: React.ReactNode
  actions?: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:flex-wrap sm:items-center",
        className,
      )}
    >
      <div className="flex flex-1 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        {children}
      </div>
      {actions ? (
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      ) : null}
    </div>
  )
}

/** Clear-all affordance shown when at least one filter is active. */
export function ClearFiltersButton({
  active,
  onClear,
}: {
  active: boolean
  onClear: () => void
}) {
  if (!active) return null
  return (
    <Button variant="ghost" size="sm" onClick={onClear}>
      <X className="size-3.5" />
      Clear
    </Button>
  )
}
