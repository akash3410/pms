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
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { useUpdateOrderStatus } from "@/features/orders/hooks"
import type { Order } from "@/features/orders/types"
import { normalizeError } from "@/lib/api/errors"
import type { DepartmentCode, ProductionStatus } from "@/lib/api/types"

/**
 * Update one department's production status.
 *
 * Business rules the UI must not bypass:
 *  - a real transition into COMPLETED credits the *current assignee* (server-side);
 *  - requesting the current status is accepted but is a no-op (no history row);
 *  - employees may only act on departments they are currently assigned to.
 */
export function StatusUpdateDialog({
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
  const mutation = useUpdateOrderStatus(order.id)
  const current =
    department === "CUTTING" ? order.cutting_status : order.operator_status
  const [status, setStatus] = React.useState<ProductionStatus>(current)
  const [note, setNote] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (open) {
      setStatus(current)
      setNote("")
      setError(null)
    }
  }, [open, current])

  const submit = async () => {
    setError(null)
    try {
      await mutation.mutateAsync({
        status,
        department,
        ...(note.trim() ? { note: note.trim() } : {}),
      })
      if (status === current) {
        toast.info("Status unchanged — the request was a no-op.")
      } else {
        toast.success(
          `${department === "CUTTING" ? "Cutting" : "Operator"} status set to ${status.toLowerCase()}.`,
        )
      }
      onOpenChange(false)
    } catch (caught) {
      const apiError = normalizeError(caught)
      setError(apiError.detail)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !mutation.isPending && onOpenChange(next)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            Update {department === "CUTTING" ? "cutting" : "operator"} status
          </DialogTitle>
          <DialogDescription>
            Order {order.order_number}. Current status: {current.toLowerCase()}.
            The overall order status is recalculated by the server.
          </DialogDescription>
        </DialogHeader>

        {error ? (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="status">New status</Label>
            <Select
              value={status}
              onValueChange={(value) => setStatus(value as ProductionStatus)}
            >
              <SelectTrigger id="status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="PENDING">Pending</SelectItem>
                <SelectItem value="COMPLETED">Completed</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Completing this department credits the employee currently assigned
              to it, once per target period.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="note">Note (optional)</Label>
            <Textarea
              id="note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Add context for the status history…"
              maxLength={1000}
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={mutation.isPending}
          >
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={mutation.isPending}>
            {mutation.isPending ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Saving…
              </>
            ) : (
              "Update status"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
