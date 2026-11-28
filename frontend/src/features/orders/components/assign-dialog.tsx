import { AlertCircle, Loader2 } from "lucide-react"
import * as React from "react"
import { toast } from "sonner"

import { Alert, AlertDescription } from "@/components/ui/misc"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useAssigneeOptions, useAssignOrder } from "@/features/orders/hooks"
import type { Order } from "@/features/orders/types"
import { normalizeError } from "@/lib/api/errors"
import type { DepartmentCode } from "@/lib/api/types"

/**
 * Assign or reassign one department on an order.
 *
 * The backend validates the employee's role/active state again and appends an
 * immutable history row; reassignment keeps the department's current status and
 * never moves completion credit.
 */
export function AssignDialog({
  order,
  department,
  open,
  onOpenChange,
}: {
  order: Order
  department: DepartmentCode
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const options = useAssigneeOptions(department)
  const assign = useAssignOrder(order.id)
  const [employeeId, setEmployeeId] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)

  const current =
    department === "CUTTING" ? order.cutting_man : order.operator

  React.useEffect(() => {
    if (open) {
      setEmployeeId("")
      setError(null)
    }
  }, [open])

  const submit = async () => {
    setError(null)
    if (!employeeId) {
      setError("Select an employee to assign.")
      return
    }
    try {
      await assign.mutateAsync({ department, employee_id: employeeId })
      toast.success(`${labelFor(department)} assignment updated.`)
      onOpenChange(false)
    } catch (caught) {
      const apiError = normalizeError(caught)
      setError(
        apiError.fieldErrors.employee_id?.join(" ") ||
          apiError.fieldErrors.employee?.join(" ") ||
          apiError.detail,
      )
    }
  }

  const candidates = (options.data ?? []).filter(
    (employee) => employee.id !== current?.id,
  )

  return (
    <Dialog open={open} onOpenChange={(next) => !assign.isPending && onOpenChange(next)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Assign {labelFor(department)}</DialogTitle>
          <DialogDescription>
            Currently {current ? `${current.full_name} (${current.employee_code})` : "unassigned"}.
            Reassignment keeps the department status and does not transfer any
            completion credit.
          </DialogDescription>
        </DialogHeader>

        {error ? (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <div className="space-y-1.5">
          <Select
            value={employeeId}
            onValueChange={setEmployeeId}
            disabled={options.isPending || options.isError}
          >
            <SelectTrigger aria-label="Employee to assign">
              <SelectValue
                placeholder={
                  options.isPending
                    ? "Loading employees…"
                    : candidates.length === 0
                      ? "No other eligible employees"
                      : "Select an employee"
                }
              />
            </SelectTrigger>
            <SelectContent>
              {candidates.map((employee) => (
                <SelectItem key={employee.id} value={employee.id}>
                  {employee.full_name} · {employee.employee_code}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {options.isError ? (
            <p role="alert" className="text-xs font-medium text-destructive">
              {normalizeError(options.error).detail}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Only active employees holding the matching production role are listed.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={assign.isPending}
          >
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={assign.isPending}>
            {assign.isPending ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Saving…
              </>
            ) : (
              "Save assignment"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function labelFor(department: DepartmentCode) {
  return department === "CUTTING" ? "Cutting Man" : "Operator"
}
