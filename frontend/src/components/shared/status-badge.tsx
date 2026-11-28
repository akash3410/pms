import { CheckCircle2, CircleDashed, Loader2 } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { humanize } from "@/lib/format"
import type { OverallStatus, ProductionStatus } from "@/lib/api/types"

/**
 * Status colours are semantic and identical everywhere:
 * pending → amber, in progress → blue, completed → emerald.
 */
export function OverallStatusBadge({ status }: { status: OverallStatus }) {
  if (status === "COMPLETED") {
    return (
      <Badge variant="success">
        <CheckCircle2 aria-hidden="true" />
        Completed
      </Badge>
    )
  }
  if (status === "IN_PROGRESS") {
    return (
      <Badge variant="info">
        <Loader2 aria-hidden="true" />
        In progress
      </Badge>
    )
  }
  return (
    <Badge variant="warning">
      <CircleDashed aria-hidden="true" />
      Pending
    </Badge>
  )
}

export function ProductionStatusBadge({ status }: { status: ProductionStatus }) {
  if (status === "COMPLETED") {
    return (
      <Badge variant="success">
        <CheckCircle2 aria-hidden="true" />
        Completed
      </Badge>
    )
  }
  return (
    <Badge variant="warning">
      <CircleDashed aria-hidden="true" />
      Pending
    </Badge>
  )
}

/** Generic enum badge for things like invitation status or department codes. */
export function EnumBadge({ value }: { value: string }) {
  const variant =
    value === "COMPLETED" || value === "ACCEPTED"
      ? "success"
      : value === "IN_PROGRESS" ||
          value === "PENDING" ||
          value === "CANCELLED"
        ? value === "CANCELLED"
          ? "destructive"
          : "warning"
        : value === "EXPIRED"
          ? "neutral"
          : "outline"
  return <Badge variant={variant}>{humanize(value)}</Badge>
}
