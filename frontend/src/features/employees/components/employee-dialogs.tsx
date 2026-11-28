import { zodResolver } from "@hookform/resolvers/zod"
import { AlertCircle, Loader2 } from "lucide-react"
import * as React from "react"
import { Controller, useForm } from "react-hook-form"
import { toast } from "sonner"
import { z } from "zod"

import { ConfirmDialog } from "@/components/shared/confirm-dialog"
import { FormField, FormGrid } from "@/components/shared/form-field"
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
import { employeesApi } from "@/features/employees/api"
import { LEGACY_ROLES, type Employee } from "@/features/employees/types"
import { useSession } from "@/features/auth/session"
import { normalizeError } from "@/lib/api/errors"
import { useQueryClient } from "@tanstack/react-query"

/* -------------------------------------------------------------------------- */
/* Edit employee                                                              */
/* -------------------------------------------------------------------------- */
const editSchema = z.object({
  full_name: z.string().trim().min(1, "Full name is required.").max(150),
  employee_code: z.string().trim().min(1, "Employee code is required.").max(40),
  role: z.custom<Employee["role"]>(
    (value) => value === "ADMIN" || value === "CUTTING_MAN" || value === "OPERATOR",
    { message: "Select a role." },
  ),
  email: z.union([z.literal(""), z.email("Enter a valid email address.")]),
})
type EditValues = z.infer<typeof editSchema>

/**
 * Employee profile edit.
 *
 * `role` is the legacy production role. Changing it requires
 * `users.manage_users` at scope ALL on the backend and is rejected while the
 * employee still holds active assignments of the other kind — both surfaced here.
 */
export function EditEmployeeDialog({
  employee,
  open,
  onOpenChange,
}: {
  employee: Employee
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const [pending, setPending] = React.useState(false)
  const [formError, setFormError] = React.useState<string | null>(null)
  const form = useForm<EditValues>({
    resolver: zodResolver(editSchema),
    values: {
      full_name: employee.full_name,
      employee_code: employee.employee_code,
      role: employee.role,
      email: employee.email ?? "",
    },
  })

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null)
    setPending(true)
    try {
      await employeesApi.update(employee.id, values)
      toast.success("Employee updated.")
      await queryClient.invalidateQueries({ queryKey: ["employees"] })
      onOpenChange(false)
    } catch (error) {
      const apiError = normalizeError(error)
      setFormError(apiError.detail)
      for (const [field, messages] of Object.entries(apiError.fieldErrors)) {
        if (field in values) {
          form.setError(field as keyof EditValues, { message: messages.join(" ") })
        }
      }
    } finally {
      setPending(false)
    }
  })

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit employee</DialogTitle>
          <DialogDescription>
            Username, password and account status are not editable here.
          </DialogDescription>
        </DialogHeader>

        {formError ? (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertDescription>{formError}</AlertDescription>
          </Alert>
        ) : null}

        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <FormField
            id="edit_full_name"
            label="Full name"
            required
            error={form.formState.errors.full_name?.message}
          >
            <Input id="edit_full_name" {...form.register("full_name")} />
          </FormField>

          <FormGrid>
            <FormField
              id="edit_employee_code"
              label="Employee code"
              required
              error={form.formState.errors.employee_code?.message}
              description="Stored upper-case and unique."
            >
              <Input id="edit_employee_code" {...form.register("employee_code")} />
            </FormField>

            <FormField
              id="edit_role"
              label="Production role"
              required
              error={form.formState.errors.role?.message}
              description="Drives which department can assign this employee."
            >
              <Controller
                control={form.control}
                name="role"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="edit_role">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {LEGACY_ROLES.map((role) => (
                        <SelectItem key={role.value} value={role.value}>
                          {role.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </FormField>
          </FormGrid>

          <FormField
            id="edit_email"
            label="Email address"
            error={form.formState.errors.email?.message}
            description="Changing it resets verification and triggers a new verification email."
          >
            <Input id="edit_email" type="email" {...form.register("email")} />
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
              ) : (
                "Save changes"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/* -------------------------------------------------------------------------- */
/* Deactivate / reactivate                                                    */
/* -------------------------------------------------------------------------- */
export function EmployeeStatusDialog({
  employee,
  open,
  onOpenChange,
}: {
  employee: Employee
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const { user } = useSession()
  const [pending, setPending] = React.useState(false)
  const isSelf = user?.id === employee.id

  const run = async () => {
    setPending(true)
    try {
      if (employee.is_active) {
        const response = await employeesApi.deactivate(employee.id)
        if (response.active_orders) {
          toast.warning(
            `Employee deactivated. ${response.active_orders} active order assignment(s) must be reassigned.`,
          )
        } else {
          toast.success("Employee deactivated.")
        }
      } else {
        await employeesApi.reactivate(employee.id)
        toast.success("Employee reactivated. Roles are not restored — assign them again.")
      }
      await queryClient.invalidateQueries({ queryKey: ["employees"] })
      onOpenChange(false)
    } catch (error) {
      toast.error(normalizeError(error).detail)
    } finally {
      setPending(false)
    }
  }

  return (
    <>
      <ConfirmDialog
        open={open}
        onOpenChange={onOpenChange}
        title={employee.is_active ? "Deactivate employee?" : "Reactivate employee?"}
        destructive={employee.is_active}
        confirmLabel={employee.is_active ? "Deactivate" : "Reactivate"}
        pending={pending}
        onConfirm={() => void run()}
        description={
          isSelf ? (
            <p>The backend rejects deactivating your own account.</p>
          ) : employee.is_active ? (
            <>
              <p>
                <strong>{employee.full_name}</strong> will be signed out and can no
                longer authenticate.
              </p>
              <p>
                All RBAC roles and department memberships are revoked immediately.
                Existing order assignments must be reassigned manually.
              </p>
              <p>The record is never deleted, so history stays intact.</p>
            </>
          ) : (
            <>
              <p>
                <strong>{employee.full_name}</strong> will be able to sign in again.
              </p>
              <p>
                Previously held roles are <strong>not</strong> restored. Assign roles
                explicitly afterwards, or the account has no access.
              </p>
            </>
          )
        }
      />
    </>
  )
}
