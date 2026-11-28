import { zodResolver } from "@hookform/resolvers/zod"
import { AlertCircle, KeyRound, Loader2 } from "lucide-react"
import * as React from "react"
import { useForm } from "react-hook-form"
import { Link } from "react-router-dom"
import { toast } from "sonner"
import { z } from "zod"

import { PageHeader } from "@/components/layout/page-header"
import { Alert, AlertDescription } from "@/components/ui/misc"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { authApi } from "@/features/auth/api"
import { PasswordField } from "@/features/auth/pages/password-pages"
import { normalizeError } from "@/lib/api/errors"

const schema = z
  .object({
    current_password: z.string().min(1, "Enter your current password."),
    new_password: z.string().min(8, "Use at least 8 characters."),
    confirm: z.string().min(1, "Confirm the new password."),
  })
  .refine((values) => values.new_password === values.confirm, {
    path: ["confirm"],
    message: "Passwords do not match.",
  })
  .refine((values) => values.new_password !== values.current_password, {
    path: ["new_password"],
    message: "Choose a password different from your current one.",
  })

type FormValues = z.infer<typeof schema>

export function ChangePasswordPage() {
  const [formError, setFormError] = React.useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string[]>>({})
  const [done, setDone] = React.useState(false)

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { current_password: "", new_password: "", confirm: "" },
  })

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null)
    setFieldErrors({})
    try {
      await authApi.changePassword({
        current_password: values.current_password,
        new_password: values.new_password,
      })
      setDone(true)
      form.reset()
      toast.success("Password changed.")
    } catch (error) {
      const apiError = normalizeError(error)
      setFormError(apiError.detail)
      setFieldErrors(apiError.fieldErrors)
    }
  })

  return (
    <div className="space-y-5">
      <PageHeader
        title="Change password"
        description="Your other sessions stay valid until their refresh tokens expire or are revoked."
        crumbs={[{ label: "Profile", to: "/profile" }, { label: "Password" }]}
        actions={
          <Button variant="outline" asChild>
            <Link to="/profile">Back to profile</Link>
          </Button>
        }
      />

      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="size-4 text-muted-foreground" />
            Update your password
          </CardTitle>
          <CardDescription>
            The backend applies Django's configured password validators.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {done ? (
            <Alert variant="success">
              <AlertDescription>
                Password updated. Use it the next time you sign in.
              </AlertDescription>
            </Alert>
          ) : null}

          <form onSubmit={onSubmit} className="mt-4 space-y-4" noValidate>
            {formError ? (
              <Alert variant="destructive">
                <AlertCircle />
                <AlertDescription>{formError}</AlertDescription>
              </Alert>
            ) : null}

            <PasswordField
              id="current_password"
              label="Current password"
              autoComplete="current-password"
              registration={form.register("current_password")}
              error={form.formState.errors.current_password?.message}
            />

            <PasswordField
              id="new_password"
              label="New password"
              registration={form.register("new_password")}
              error={
                form.formState.errors.new_password?.message ??
                fieldErrors.new_password?.join(" ")
              }
              hint="At least 8 characters. Avoid common or entirely numeric passwords."
            />

            <PasswordField
              id="confirm"
              label="Confirm new password"
              registration={form.register("confirm")}
              error={form.formState.errors.confirm?.message}
            />

            <Button type="submit" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Updating…
                </>
              ) : (
                "Update password"
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
