import * as React from "react"

import { FieldMessage } from "@/components/feedback/states"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"

/**
 * Label + control + validation message in one accessible block.
 * Keeps long forms readable and consistent across modules.
 */
export function FormField({
  id,
  label,
  description,
  error,
  required,
  children,
  className,
}: {
  id: string
  label: string
  description?: React.ReactNode
  error?: string
  required?: boolean
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={id}>
        {label}
        {required ? (
          <span className="text-destructive" aria-hidden="true">
            *
          </span>
        ) : null}
      </Label>
      {children}
      {description ? (
        <p className="text-xs text-muted-foreground">{description}</p>
      ) : null}
      <FieldMessage message={error} />
    </div>
  )
}

/** Two-column responsive form grid used by all create/edit dialogs. */
export function FormGrid({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn("grid gap-4 sm:grid-cols-2", className)}>{children}</div>
  )
}
