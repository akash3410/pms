import { zodResolver } from "@hookform/resolvers/zod"
import { AlertCircle, Loader2 } from "lucide-react"
import * as React from "react"
import { Controller, useForm } from "react-hook-form"
import { Link, useNavigate } from "react-router-dom"
import { toast } from "sonner"
import { z } from "zod"

import { PageHeader } from "@/components/layout/page-header"
import { FormField, FormGrid } from "@/components/shared/form-field"
import { Alert, AlertDescription } from "@/components/ui/misc"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { employeesApi } from "@/features/employees/api"
import { LEGACY_ROLES } from "@/features/employees/types"
import { normalizeError } from "@/lib/api/errors"
import type { LegacyRole } from "@/lib/api/types"

const schema = z.object({
  username: z
    .string()
    .trim()
    .min(1, "Username is required.")
    .max(150, "At most 150 characters.")
    .regex(
      /^[\w.@+-]+$/,
      "Use letters, digits and @ . + - _ only (Django username rules).",
    ),
  password: z.string().min(8, "Use at least 8 characters."),
  full_name: z.string().trim().min(1, "Full name is required.").max(150),
  employee_code: z.string().trim().min(1, "Employee code is required.").max(40),
  role: z.custom<LegacyRole>(
    (value) => value === "ADMIN" || value === "CUTTING_MAN" || value === "OPERATOR",
    { message: "Select a role." },
  ),
  email: z.union([z.literal(""), z.email("Enter a valid email address.")]),
})

type FormValues = z.infer<typeof schema>

export function EmployeeCreatePage() {
  const navigate = useNavigate()
  const [formError, setFormError] = React.useState<string | null>(null)

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      username: "",
      password: "",
      full_name: "",
      employee_code: "",
      role: "OPERATOR",
      email: "",
    },
  })

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null)
    try {
      const employee = await employeesApi.create({
        username: values.username,
        password: values.password,
        full_name: values.full_name,
        employee_code: values.employee_code,
        role: values.role,
        email: values.email,
      })
      toast.success(`${employee.full_name} created.`)
      navigate(`/employees/${employee.id}`, { replace: true })
    } catch (error) {
      const apiError = normalizeError(error)
      setFormError(apiError.detail)
      for (const [field, messages] of Object.entries(apiError.fieldErrors)) {
        if (field in values) {
          form.setError(field as keyof FormValues, { message: messages.join(" ") })
        }
      }
    }
  })

  return (
    <div className="space-y-5">
      <PageHeader
        title="New employee"
        description="Creates an account immediately with a password you set. RBAC roles and department memberships are assigned separately."
        crumbs={[{ label: "Employees", to: "/employees" }, { label: "New" }]}
        actions={
          <Button variant="outline" asChild>
            <Link to="/employees">Cancel</Link>
          </Button>
        }
      />

      <form onSubmit={onSubmit} className="grid gap-5 lg:grid-cols-[1.4fr_1fr]" noValidate>
        <Card>
          <CardHeader>
            <CardTitle>Account details</CardTitle>
            <CardDescription>
              The username and employee code must be unique.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {formError ? (
              <Alert variant="destructive">
                <AlertCircle />
                <AlertDescription>{formError}</AlertDescription>
              </Alert>
            ) : null}

            <FormGrid>
              <FormField
                id="full_name"
                label="Full name"
                required
                error={form.formState.errors.full_name?.message}
              >
                <Input id="full_name" autoFocus {...form.register("full_name")} />
              </FormField>

              <FormField
                id="employee_code"
                label="Employee code"
                required
                error={form.formState.errors.employee_code?.message}
                description="Stored upper-case."
              >
                <Input id="employee_code" placeholder="EMP-001" {...form.register("employee_code")} />
              </FormField>

              <FormField
                id="username"
                label="Username"
                required
                error={form.formState.errors.username?.message}
              >
                <Input id="username" autoComplete="off" {...form.register("username")} />
              </FormField>

              <FormField
                id="password"
                label="Initial password"
                required
                error={form.formState.errors.password?.message}
                description="Share it securely; the employee can change it after signing in."
              >
                <Input
                  id="password"
                  type="password"
                  autoComplete="new-password"
                  {...form.register("password")}
                />
              </FormField>

              <FormField
                id="role"
                label="Production role"
                required
                error={form.formState.errors.role?.message}
                description="Determines which department may assign this employee."
              >
                <Controller
                  control={form.control}
                  name="role"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger id="role">
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

              <FormField
                id="email"
                label="Email address"
                error={form.formState.errors.email?.message}
                description="Optional, but required for email invitations and password resets."
              >
                <Input id="email" type="email" {...form.register("email")} />
              </FormField>
            </FormGrid>
          </CardContent>
        </Card>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle>What the backend does</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <ul className="list-disc space-y-2 pl-4">
              <li>
                The legacy production role is bridged into the matching system RBAC
                role.
              </li>
              <li>
                A department membership is created for the matching production
                department.
              </li>
              <li>
                An email verification message is queued when an address is provided.
              </li>
              <li>
                The account is audited as <code>user.created</code>.
              </li>
            </ul>
            <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Creating…
                </>
              ) : (
                "Create employee"
              )}
            </Button>
          </CardContent>
        </Card>
      </form>
    </div>
  )
}
