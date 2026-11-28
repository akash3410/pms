import { zodResolver } from "@hookform/resolvers/zod"
import { AlertCircle, BadgeCheck, KeyRound, Loader2, MailWarning } from "lucide-react"
import * as React from "react"
import { useForm } from "react-hook-form"
import { Link } from "react-router-dom"
import { toast } from "sonner"
import { z } from "zod"

import { ErrorState, LoadingState } from "@/components/feedback/states"
import { PageHeader } from "@/components/layout/page-header"
import { FormField } from "@/components/shared/form-field"
import { Alert, AlertDescription } from "@/components/ui/misc"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { authApi } from "@/features/auth/api"
import { useSession } from "@/features/auth/session"
import { formatDateTime, humanize } from "@/lib/format"
import { normalizeError } from "@/lib/api/errors"

const profileSchema = z.object({
  full_name: z
    .string()
    .trim()
    .min(1, "Full name is required.")
    .max(150, "At most 150 characters."),
  // The backend owns the email; we only allow a well-formed value.
  email: z.union([z.literal(""), z.email("Enter a valid email address.")]),
})
type ProfileValues = z.infer<typeof profileSchema>

export function ProfilePage() {
  const { user, updateUser, refreshAccess, refreshUser } = useSession()
  const [formError, setFormError] = React.useState<string | null>(null)
  const [sending, setSending] = React.useState(false)

  const form = useForm<ProfileValues>({
    resolver: zodResolver(profileSchema),
    values: {
      full_name: user?.full_name ?? "",
      email: user?.email ?? "",
    },
  })

  if (!user) {
    return <LoadingState label="Loading your profile…" />
  }

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null)
    try {
      const updated = await authApi.updateProfile({
        full_name: values.full_name,
        email: values.email,
      })
      updateUser(updated)
      toast.success("Profile updated.")
      // Roles are unaffected, but refresh in case the backend changed anything.
      await refreshUser()
      await refreshAccess().catch(() => undefined)
    } catch (error) {
      const apiError = normalizeError(error)
      setFormError(apiError.detail)
      for (const [field, messages] of Object.entries(apiError.fieldErrors)) {
        if (field === "full_name" || field === "email") {
          form.setError(field, { message: messages.join(" ") })
        }
      }
    }
  })

  const resend = async () => {
    setSending(true)
    try {
      const response = await authApi.resendVerification()
      toast.success(response.detail)
    } catch (error) {
      toast.error(normalizeError(error).detail)
    } finally {
      setSending(false)
    }
  }

  const verified = Boolean(user.email_verified_at)

  return (
    <div className="space-y-5">
      <PageHeader
        title="My profile"
        description="Your own account details. Employee code, username and access are managed by an administrator."
        crumbs={[{ label: "Profile" }]}
        actions={
          <Button variant="outline" asChild>
            <Link to="/change-password">
              <KeyRound className="size-4" />
              Change password
            </Link>
          </Button>
        }
      />

      <div className="grid gap-5 lg:grid-cols-[1.3fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Profile details</CardTitle>
            <CardDescription>
              Changing your email address marks it unverified until you confirm it.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit} className="space-y-4" noValidate>
              {formError ? (
                <Alert variant="destructive">
                  <AlertCircle />
                  <AlertDescription>{formError}</AlertDescription>
                </Alert>
              ) : null}

              <FormField
                id="full_name"
                label="Full name"
                required
                error={form.formState.errors.full_name?.message}
              >
                <Input id="full_name" {...form.register("full_name")} />
              </FormField>

              <FormField
                id="email"
                label="Email address"
                error={form.formState.errors.email?.message}
                description="Used for sign-in, invitations and password resets."
              >
                <Input id="email" type="email" {...form.register("email")} />
              </FormField>

              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  id="employee_code"
                  label="Employee code"
                  description="Immutable; assigned by an administrator."
                >
                  <Input id="employee_code" value={user.employee_code} readOnly disabled />
                </FormField>
                <FormField
                  id="username"
                  label="Username"
                  description="Immutable; used for legacy integrations."
                >
                  <Input id="username" value={user.username} readOnly disabled />
                </FormField>
              </div>

              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Saving…
                  </>
                ) : (
                  "Save profile"
                )}
              </Button>
            </form>
          </CardContent>
        </Card>

        <div className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle>Access</CardTitle>
              <CardDescription>
                Resolved live from the backend on each request — never from the token.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div>
                <p className="text-xs text-muted-foreground">RBAC roles</p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {user.roles.length === 0 ? (
                    <span className="text-sm text-muted-foreground">No roles assigned</span>
                  ) : (
                    user.roles.map((role) => (
                      <Badge key={role} variant="outline">
                        {role}
                      </Badge>
                    ))
                  )}
                </div>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Production role</p>
                <p className="font-medium">{humanize(user.role)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Account created</p>
                <p className="font-medium">{formatDateTime(user.date_joined)}</p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Email verification</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {verified ? (
                <Alert variant="success">
                  <BadgeCheck />
                  <AlertDescription>
                    Verified on {formatDateTime(user.email_verified_at)}.
                  </AlertDescription>
                </Alert>
              ) : (
                <>
                  <Alert variant="warning">
                    <MailWarning />
                    <AlertDescription>
                      Your email address is not verified yet. Depending on the
                      system policy, some actions may be restricted.
                    </AlertDescription>
                  </Alert>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void resend()}
                    disabled={sending || !user.email}
                  >
                    {sending ? (
                      <>
                        <Loader2 className="size-4 animate-spin" />
                        Sending…
                      </>
                    ) : (
                      "Resend verification email"
                    )}
                  </Button>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

/** Kept exported for the router's error boundary fallback. */
export function ProfileUnavailable() {
  return <ErrorState error={new Error("Profile unavailable")} />
}
