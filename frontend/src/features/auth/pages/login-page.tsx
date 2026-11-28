import { zodResolver } from "@hookform/resolvers/zod"
import { AlertCircle, Eye, EyeOff, Loader2, LockKeyhole, Mail } from "lucide-react"
import * as React from "react"
import { useForm } from "react-hook-form"
import { Link, useLocation, useNavigate } from "react-router-dom"
import { z } from "zod"

import { Alert, AlertDescription } from "@/components/ui/misc"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { FieldMessage } from "@/components/feedback/states"
import { AuthLayout } from "@/features/auth/components/auth-layout"
import { useSession } from "@/features/auth/session"
import { normalizeError } from "@/lib/api/errors"

const schema = z.object({
  identifier: z.string().trim().min(1, "Enter your email address."),
  password: z.string().min(1, "Enter your password."),
})

type LoginValues = z.infer<typeof schema>

interface LocationState {
  from?: string
}

export function LoginPage() {
  const { login, status } = useSession()
  const navigate = useNavigate()
  const location = useLocation()
  const [showPassword, setShowPassword] = React.useState(false)
  const [formError, setFormError] = React.useState<string | null>(null)

  const form = useForm<LoginValues>({
    resolver: zodResolver(schema),
    defaultValues: { identifier: "", password: "" },
  })

  const redirectTo =
    (location.state as LocationState | null)?.from ?? "/"

  // Already signed in (e.g. navigating back to /login): leave immediately.
  React.useEffect(() => {
    if (status === "authenticated") {
      navigate(redirectTo, { replace: true })
    }
  }, [status, navigate, redirectTo])

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null)
    try {
      await login(values.identifier, values.password)
      navigate(redirectTo, { replace: true })
    } catch (error) {
      const apiError = normalizeError(error)
      setFormError(apiError.detail)
    }
  })

  const submitting = form.formState.isSubmitting

  return (
    <AuthLayout
      title="Sign in"
      description="Use the email address and password issued for your POMS account."
    >
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {formError ? (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertDescription>{formError}</AlertDescription>
          </Alert>
        ) : null}

        <div className="space-y-1.5">
          <Label htmlFor="identifier">Email or username</Label>
          <div className="relative">
            <Mail
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              id="identifier"
              type="text"
              autoComplete="username"
              autoFocus
              placeholder="you@company.com"
              className="pl-9"
              aria-invalid={Boolean(form.formState.errors.identifier)}
              {...form.register("identifier")}
            />
          </div>
          <FieldMessage message={form.formState.errors.identifier?.message} />
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="password">Password</Label>
            <Link
              to="/forgot-password"
              className="text-xs font-medium text-primary hover:underline"
            >
              Forgot password?
            </Link>
          </div>
          <div className="relative">
            <LockKeyhole
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              id="password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              placeholder="••••••••"
              className="pr-9 pl-9"
              aria-invalid={Boolean(form.formState.errors.password)}
              {...form.register("password")}
            />
            <button
              type="button"
              onClick={() => setShowPassword((value) => !value)}
              className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
          <FieldMessage message={form.formState.errors.password?.message} />
        </div>

        <Button type="submit" className="w-full" disabled={submitting}>
          {submitting ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              Signing in…
            </>
          ) : (
            "Sign in"
          )}
        </Button>

        <p className="text-center text-xs text-muted-foreground">
          Invited to POMS? Open the link in your invitation email to activate
          your account.
        </p>
      </form>
    </AuthLayout>
  )
}
