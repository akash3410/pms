/**
 * Forgot-password, reset-password, invitation acceptance and email verification.
 *
 * All four endpoints are public. The backend deliberately never reveals whether
 * an email address exists (forgot-password always answers 204), so the UI keeps
 * its confirmation message identical in both cases.
 */
import { zodResolver } from "@hookform/resolvers/zod"
import {
  AlertCircle,
  CheckCircle2,
  Eye,
  EyeOff,
  Loader2,
  MailCheck,
} from "lucide-react"
import * as React from "react"
import { useForm, type UseFormRegisterReturn } from "react-hook-form"
import { Link, useSearchParams } from "react-router-dom"
import { z } from "zod"

import { FieldMessage } from "@/components/feedback/states"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/misc"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { AuthLayout } from "@/features/auth/components/auth-layout"
import { authApi } from "@/features/auth/api"
import { normalizeError } from "@/lib/api/errors"

/* -------------------------------------------------------------------------- */
/* Forgot password                                                            */
/* -------------------------------------------------------------------------- */
const forgotSchema = z.object({
  email: z.string().trim().min(1, "Enter your email address.").email("Enter a valid email address."),
})
type ForgotValues = z.infer<typeof forgotSchema>

export function ForgotPasswordPage() {
  const [sent, setSent] = React.useState(false)
  const [formError, setFormError] = React.useState<string | null>(null)
  const form = useForm<ForgotValues>({
    resolver: zodResolver(forgotSchema),
    defaultValues: { email: "" },
  })

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null)
    try {
      await authApi.forgotPassword(values.email)
      setSent(true)
    } catch (error) {
      setFormError(normalizeError(error).detail)
    }
  })

  if (sent) {
    return (
      <AuthLayout
        title="Check your inbox"
        description="If an account exists for that address, a password reset link is on its way."
        footer={
          <Link to="/login" className="font-medium text-primary hover:underline">
            Back to sign in
          </Link>
        }
      >
        <Alert variant="success">
          <MailCheck />
          <AlertTitle>Request received</AlertTitle>
          <AlertDescription>
            The link expires according to the system configuration. If you do not
            receive it, ask an administrator to confirm your email address.
          </AlertDescription>
        </Alert>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout
      title="Reset your password"
      description="Enter the email address associated with your account."
      footer={
        <Link to="/login" className="font-medium text-primary hover:underline">
          Back to sign in
        </Link>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {formError ? (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertDescription>{formError}</AlertDescription>
          </Alert>
        ) : null}
        <div className="space-y-1.5">
          <Label htmlFor="email">Email address</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            autoFocus
            placeholder="you@company.com"
            aria-invalid={Boolean(form.formState.errors.email)}
            {...form.register("email")}
          />
          <FieldMessage message={form.formState.errors.email?.message} />
        </div>
        <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              Sending…
            </>
          ) : (
            "Send reset link"
          )}
        </Button>
      </form>
    </AuthLayout>
  )
}

/* -------------------------------------------------------------------------- */
/* Password field with reveal toggle                                          */
/* -------------------------------------------------------------------------- */
export function PasswordField({
  id,
  label,
  registration,
  error,
  autoComplete = "new-password",
  hint,
}: {
  id: string
  label: string
  registration: UseFormRegisterReturn
  error?: string
  autoComplete?: string
  hint?: string
}) {
  const [visible, setVisible] = React.useState(false)
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input
          id={id}
          type={visible ? "text" : "password"}
          autoComplete={autoComplete}
          className="pr-9"
          aria-invalid={Boolean(error)}
          {...registration}
        />
        <button
          type="button"
          onClick={() => setVisible((value) => !value)}
          className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
          aria-label={visible ? "Hide password" : "Show password"}
        >
          {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      </div>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      <FieldMessage message={error} />
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Reset password                                                             */
/* -------------------------------------------------------------------------- */
const passwordSchema = z
  .object({
    password: z.string().min(8, "Use at least 8 characters."),
    confirm: z.string().min(1, "Confirm the new password."),
  })
  .refine((values) => values.password === values.confirm, {
    path: ["confirm"],
    message: "Passwords do not match.",
  })
type PasswordValues = z.infer<typeof passwordSchema>

export function ResetPasswordPage() {
  const [params] = useSearchParams()
  const token = params.get("token") ?? ""
  const [done, setDone] = React.useState(false)
  const [formError, setFormError] = React.useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string[]>>({})

  const form = useForm<PasswordValues>({
    resolver: zodResolver(passwordSchema),
    defaultValues: { password: "", confirm: "" },
  })

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null)
    setFieldErrors({})
    try {
      await authApi.resetPassword(token, values.password)
      setDone(true)
    } catch (error) {
      const apiError = normalizeError(error)
      setFormError(apiError.detail)
      setFieldErrors(apiError.fieldErrors)
    }
  })

  if (!token) {
    return (
      <AuthLayout title="Invalid reset link" description="This link is missing its token.">
        <Alert variant="destructive">
          <AlertCircle />
          <AlertDescription>
            Request a new password reset email and use the link it contains.
          </AlertDescription>
        </Alert>
        <Button asChild className="w-full">
          <Link to="/forgot-password">Request a new link</Link>
        </Button>
      </AuthLayout>
    )
  }

  if (done) {
    return (
      <AuthLayout
        title="Password updated"
        description="Your new password is active. Sign in to continue."
      >
        <Alert variant="success">
          <CheckCircle2 />
          <AlertDescription>You can now use your new password.</AlertDescription>
        </Alert>
        <Button asChild className="w-full">
          <Link to="/login">Go to sign in</Link>
        </Button>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout title="Choose a new password" description="Enter and confirm your new password.">
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {formError ? (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertDescription>{formError}</AlertDescription>
          </Alert>
        ) : null}
        <PasswordField
          id="password"
          label="New password"
          registration={form.register("password")}
          error={form.formState.errors.password?.message}
        />
        {fieldErrors.new_password ? (
          <FieldMessage message={fieldErrors.new_password.join(" ")} />
        ) : null}
        <PasswordField
          id="confirm"
          label="Confirm password"
          registration={form.register("confirm")}
          error={form.formState.errors.confirm?.message}
        />
        <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              Saving…
            </>
          ) : (
            "Set new password"
          )}
        </Button>
      </form>
    </AuthLayout>
  )
}

/* -------------------------------------------------------------------------- */
/* Invitation acceptance                                                      */
/* -------------------------------------------------------------------------- */
export function AcceptInvitationPage() {
  const [params] = useSearchParams()
  const token = params.get("token") ?? ""
  const [done, setDone] = React.useState(false)
  const [formError, setFormError] = React.useState<string | null>(null)

  const form = useForm<PasswordValues>({
    resolver: zodResolver(passwordSchema),
    defaultValues: { password: "", confirm: "" },
  })

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null)
    try {
      await authApi.acceptInvitation(token, values.password)
      setDone(true)
    } catch (error) {
      setFormError(normalizeError(error).detail)
    }
  })

  if (!token) {
    return (
      <AuthLayout
        title="Invitation link incomplete"
        description="This invitation link is missing its token."
      >
        <Alert variant="destructive">
          <AlertCircle />
          <AlertDescription>
            Ask an administrator to resend your invitation.
          </AlertDescription>
        </Alert>
      </AuthLayout>
    )
  }

  if (done) {
    return (
      <AuthLayout
        title="Welcome to POMS"
        description="Your account is active."
      >
        <Alert variant="success">
          <CheckCircle2 />
          <AlertDescription>Sign in with your email and new password.</AlertDescription>
        </Alert>
        <Button asChild className="w-full">
          <Link to="/login">Go to sign in</Link>
        </Button>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout
      title="Accept your invitation"
      description="Choose a password to activate your POMS account."
      footer={
        <Link to="/login" className="font-medium text-primary hover:underline">
          Back to sign in
        </Link>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {formError ? (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertDescription>{formError}</AlertDescription>
          </Alert>
        ) : null}
        <PasswordField
          id="password"
          label="Password"
          registration={form.register("password")}
          error={form.formState.errors.password?.message}
        />
        <PasswordField
          id="confirm"
          label="Confirm password"
          registration={form.register("confirm")}
          error={form.formState.errors.confirm?.message}
        />
        <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              Activating…
            </>
          ) : (
            "Activate account"
          )}
        </Button>
      </form>
    </AuthLayout>
  )
}

/* -------------------------------------------------------------------------- */
/* Email verification                                                         */
/* -------------------------------------------------------------------------- */
export function VerifyEmailPage() {
  const [params] = useSearchParams()
  const token = params.get("token") ?? ""
  const [state, setState] = React.useState<"pending" | "success" | "error">("pending")
  const [message, setMessage] = React.useState("")

  React.useEffect(() => {
    if (!token) {
      setState("error")
      setMessage("This verification link is missing its token.")
      return
    }
    let cancelled = false
    authApi
      .verifyEmail(token)
      .then((response) => {
        if (cancelled) return
        setState("success")
        setMessage(response.detail)
      })
      .catch((error) => {
        if (cancelled) return
        setState("error")
        setMessage(normalizeError(error).detail)
      })
    return () => {
      cancelled = true
    }
  }, [token])

  return (
    <AuthLayout title="Email verification">
      {state === "pending" ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Verifying your email address…
        </div>
      ) : null}
      {state === "success" ? (
        <Alert variant="success">
          <CheckCircle2 />
          <AlertTitle>Verified</AlertTitle>
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      ) : null}
      {state === "error" ? (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>Verification failed</AlertTitle>
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      ) : null}
      <Button asChild className="w-full">
        <Link to="/login">Continue to sign in</Link>
      </Button>
    </AuthLayout>
  )
}
