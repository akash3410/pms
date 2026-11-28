import { zodResolver } from "@hookform/resolvers/zod"
import { AlertCircle, Loader2 } from "lucide-react"
import * as React from "react"
import { Controller, useForm } from "react-hook-form"
import { toast } from "sonner"
import { z } from "zod"

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
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { FormField, FormGrid } from "@/components/shared/form-field"
import { useCreateTarget, useTargetEmployees, useUpdateTarget } from "@/features/targets/hooks"
import { type EmployeeTarget } from "@/features/targets/types"
import { normalizeError } from "@/lib/api/errors"
import {
  PERIOD_TYPES,
  type DepartmentCode,
  type PeriodType,
} from "@/lib/api/types"

const schema = z
  .object({
    employee: z.string().uuid("Select an employee."),
    department: z.custom<DepartmentCode>(
      (value) => value === "CUTTING" || value === "OPERATOR",
      { message: "Select a department." },
    ),
    period_type: z.custom<PeriodType>(
      (value) => value === "DAILY" || value === "WEEKLY" || value === "MONTHLY",
      { message: "Select a period type." },
    ),
    start_date: z.string().min(1, "Start date is required."),
    end_date: z.string().min(1, "End date is required."),
    target_count: z
      .number({ message: "Enter a whole number." })
      .int("Enter a whole number.")
      .min(1, "Target must be at least 1."),
  })
  .refine((values) => values.end_date >= values.start_date, {
    path: ["end_date"],
    message: "End date must be on or after the start date.",
  })

type FormValues = z.infer<typeof schema>

const today = () => new Date().toISOString().slice(0, 10)

/**
 * Create or edit an employee target.
 *
 * Overlap and department/role validation is enforced by the backend; the dialog
 * only surfaces those errors. Once a target has completion credits the backend
 * freezes employee/department/period/dates, so those inputs are disabled here to
 * match (the server would reject the change anyway).
 */
export function TargetFormDialog({
  open,
  onOpenChange,
  target,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  target?: EmployeeTarget
}) {
  const isEdit = Boolean(target)
  const createTarget = useCreateTarget()
  const updateTarget = useUpdateTarget(target?.id ?? "")
  const employees = useTargetEmployees()
  const [formError, setFormError] = React.useState<string | null>(null)

  const frozen = Boolean(target && target.achieved_count > 0)

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      employee: target?.employee.id ?? "",
      department: (target?.department ?? "CUTTING") as DepartmentCode,
      period_type: (target?.period_type ?? "DAILY") as PeriodType,
      start_date: target?.start_date ?? today(),
      end_date: target?.end_date ?? today(),
      target_count: target?.target_count ?? 1,
    },
  })

  React.useEffect(() => {
    if (!open) return
    setFormError(null)
    form.reset({
      employee: target?.employee.id ?? "",
      department: (target?.department ?? "CUTTING") as DepartmentCode,
      period_type: (target?.period_type ?? "DAILY") as PeriodType,
      start_date: target?.start_date ?? today(),
      end_date: target?.end_date ?? today(),
      target_count: target?.target_count ?? 1,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, target])

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null)
    const payload = { ...values, target_count: Number(values.target_count) }
    try {
      if (target) {
        await updateTarget.mutateAsync(
          frozen
            ? { target_count: payload.target_count }
            : payload,
        )
        toast.success("Target updated.")
      } else {
        await createTarget.mutateAsync(payload)
        toast.success("Target created.")
      }
      onOpenChange(false)
    } catch (error) {
      const apiError = normalizeError(error)
      setFormError(apiError.detail)
      const fieldNames: (keyof FormValues)[] = [
        "employee",
        "department",
        "period_type",
        "start_date",
        "end_date",
        "target_count",
      ]
      for (const [field, messages] of Object.entries(apiError.fieldErrors)) {
        const key = field as keyof FormValues
        if (fieldNames.includes(key)) {
          form.setError(key, { message: messages.join(" ") })
        }
      }
    }
  })

  const pending = createTarget.isPending || updateTarget.isPending

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit target" : "New target"}</DialogTitle>
          <DialogDescription>
            One target per employee, department and period type for any overlapping
            date range. Overlaps are rejected by the server.
          </DialogDescription>
        </DialogHeader>

        {formError ? (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertDescription>{formError}</AlertDescription>
          </Alert>
        ) : null}

        {frozen ? (
          <Alert variant="warning">
            <AlertDescription>
              This target already has completion credits, so employee, department,
              period and dates are locked. Only the target count can change.
            </AlertDescription>
          </Alert>
        ) : null}

        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <FormField
            id="target_employee"
            label="Employee"
            required
            error={form.formState.errors.employee?.message}
            description="Only active Cutting Man / Operator accounts can hold a target."
          >
            <Controller
              control={form.control}
              name="employee"
              render={({ field }) => (
                <Select
                  value={field.value}
                  onValueChange={field.onChange}
                  disabled={frozen || employees.isPending}
                >
                  <SelectTrigger id="target_employee">
                    <SelectValue
                      placeholder={
                        employees.isPending ? "Loading employees…" : "Select an employee"
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {(employees.data ?? []).map((employee) => (
                      <SelectItem key={employee.id} value={employee.id}>
                        {employee.full_name} · {employee.employee_code}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </FormField>

          <FormGrid>
            <FormField
              id="target_department"
              label="Department"
              required
              error={form.formState.errors.department?.message}
            >
              <Controller
                control={form.control}
                name="department"
                render={({ field }) => (
                  <Select
                    value={field.value}
                    onValueChange={field.onChange}
                    disabled={frozen}
                  >
                    <SelectTrigger id="target_department">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="CUTTING">Cutting</SelectItem>
                      <SelectItem value="OPERATOR">Operator</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
            </FormField>

            <FormField
              id="target_period"
              label="Period type"
              required
              error={form.formState.errors.period_type?.message}
            >
              <Controller
                control={form.control}
                name="period_type"
                render={({ field }) => (
                  <Select
                    value={field.value}
                    onValueChange={field.onChange}
                    disabled={frozen}
                  >
                    <SelectTrigger id="target_period">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PERIOD_TYPES.map((period) => (
                        <SelectItem key={period.value} value={period.value}>
                          {period.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </FormField>

            <FormField
              id="target_start"
              label="Start date"
              required
              error={
                form.formState.errors.start_date?.message
              }
            >
              <Input
                id="target_start"
                type="date"
                disabled={frozen}
                {...form.register("start_date")}
              />
            </FormField>

            <FormField
              id="target_end"
              label="End date"
              required
              error={form.formState.errors.end_date?.message}
            >
              <Input
                id="target_end"
                type="date"
                disabled={frozen}
                {...form.register("end_date")}
              />
            </FormField>
          </FormGrid>

          <FormField
            id="target_count"
            label="Target count"
            required
            error={form.formState.errors.target_count?.message}
            description="Number of completed orders expected in this period."
          >
            <Input
              id="target_count"
              type="number"
              min={1}
              step={1}
              {...form.register("target_count", { valueAsNumber: true })}
            />
          </FormField>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Saving…
                </>
              ) : isEdit ? (
                "Save target"
              ) : (
                "Create target"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
