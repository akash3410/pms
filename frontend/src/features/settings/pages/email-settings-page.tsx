import { Loader2, MailCheck, Save, Send } from "lucide-react"
import * as React from "react"
import { toast } from "sonner"
import axios from "axios"

import { Can, useAccess } from "@/app/access"
import { ErrorState, LoadingState } from "@/components/feedback/states"
import { PageHeader } from "@/components/layout/page-header"
import { FormField } from "@/components/shared/form-field"
import { Alert, AlertDescription, Separator, Switch } from "@/components/ui/misc"
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
import { Label } from "@/components/ui/label"
import {
  useEmailConfiguration,
  useTestEmail,
  useUpdateEmailConfiguration,
} from "@/features/settings/hooks"
import { normalizeError } from "@/lib/api/errors"

interface Draft {
  host: string
  port: string
  username: string
  from_email: string
  timeout: string
  password_env_var: string
  use_tls: boolean
  use_ssl: boolean
  is_active: boolean
}

const EMPTY: Draft = {
  host: "",
  port: "587",
  username: "",
  from_email: "",
  timeout: "10",
  password_env_var: "EMAIL_HOST_PASSWORD",
  use_tls: true,
  use_ssl: false,
  is_active: false,
}

export function EmailSettingsPage() {
  const { isSuperuser } = useAccess()
  const query = useEmailConfiguration(true)
  const update = useUpdateEmailConfiguration()
  const test = useTestEmail()

  const [draft, setDraft] = React.useState<Draft>(EMPTY)
  const [dirty, setDirty] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [testAddress, setTestAddress] = React.useState("")
  const [lastTest, setLastTest] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!query.data) return
    setDraft({
      host: query.data.host,
      port: String(query.data.port),
      username: query.data.username,
      from_email: query.data.from_email,
      timeout: String(query.data.timeout),
      password_env_var: query.data.password_env_var,
      use_tls: query.data.use_tls,
      use_ssl: query.data.use_ssl,
      is_active: query.data.is_active,
    })
    setDirty(false)
  }, [query.data])

  if (query.isPending) return <LoadingState label="Loading email configuration…" />
  if (query.isError) {
    return (
      <div className="space-y-4">
        <PageHeader title="Email configuration" crumbs={[{ label: "Email" }]} />
        <ErrorState
          error={query.error}
          title="Could not load the email configuration"
          onRetry={() => void query.refetch()}
        />
      </div>
    )
  }

  const config = query.data
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }))
    setDirty(true)
  }

  const save = async () => {
    setError(null)
    try {
      await update.mutateAsync({
        host: draft.host,
        port: Number(draft.port),
        username: draft.username,
        from_email: draft.from_email,
        timeout: Number(draft.timeout),
        password_env_var: draft.password_env_var,
        use_tls: draft.use_tls,
        use_ssl: draft.use_ssl,
        is_active: draft.is_active,
      })
      toast.success("Email configuration saved.")
      setDirty(false)
    } catch (caught) {
      setError(normalizeError(caught).detail)
    }
  }

  const sendTest = async () => {
    setLastTest(null)
    try {
      const result = await test.mutateAsync(testAddress || undefined)
      setLastTest(result.detail)
      toast.success(result.detail)
    } catch (caught) {
      const apiError = normalizeError(caught)
      // A 502 body carries the exception class name, never credentials.
      const reason = axios.isAxiosError<{ reason?: string }>(caught)
        ? caught.response?.data?.reason
        : undefined
      setLastTest(reason ? `${apiError.detail} (${reason})` : apiError.detail)
      toast.error(apiError.detail)
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Email configuration"
        description="SMTP transport used for invitations, verification and password resets."
        crumbs={[{ label: "Email configuration" }]}
        actions={isSuperuser ? <Badge variant="info">Superuser</Badge> : null}
      />

      <Alert>
        <MailCheck />
        <AlertDescription>
          Passwords are never accepted or stored by the API. Put the SMTP password
          in the environment variable named below and manage it through your secret
          manager.
        </AlertDescription>
      </Alert>

      <Can permission="system.manage_email_config">
        <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
          <Card>
            <CardHeader>
              <CardTitle>SMTP transport</CardTitle>
              <CardDescription>
                Current status:{" "}
                {config.is_active ? (
                  <Badge variant="success">Active</Badge>
                ) : (
                  <Badge variant="neutral">Inactive</Badge>
                )}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {error ? (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              ) : null}

              <div className="grid gap-3 sm:grid-cols-2">
                <FormField id="smtp-host" label="Host" required>
                  <Input
                    id="smtp-host"
                    value={draft.host}
                    onChange={(event) => set("host", event.target.value)}
                  />
                </FormField>
                <FormField id="smtp-port" label="Port" required>
                  <Input
                    id="smtp-port"
                    type="number"
                    min={1}
                    max={65535}
                    value={draft.port}
                    onChange={(event) => set("port", event.target.value)}
                  />
                </FormField>
                <FormField id="smtp-user" label="Username">
                  <Input
                    id="smtp-user"
                    value={draft.username}
                    onChange={(event) => set("username", event.target.value)}
                  />
                </FormField>
                <FormField id="smtp-from" label="From address" required>
                  <Input
                    id="smtp-from"
                    type="email"
                    value={draft.from_email}
                    onChange={(event) => set("from_email", event.target.value)}
                  />
                </FormField>
                <FormField
                  id="smtp-env"
                  label="Password environment variable"
                  required
                  description="The API reads the SMTP password from this variable."
                >
                  <Input
                    id="smtp-env"
                    value={draft.password_env_var}
                    onChange={(event) => set("password_env_var", event.target.value)}
                  />
                </FormField>
                <FormField id="smtp-timeout" label="Timeout (seconds)">
                  <Input
                    id="smtp-timeout"
                    type="number"
                    min={1}
                    max={120}
                    value={draft.timeout}
                    onChange={(event) => set("timeout", event.target.value)}
                  />
                </FormField>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <div className="flex items-center gap-2">
                  <Switch
                    id="smtp-tls"
                    checked={draft.use_tls}
                    onCheckedChange={(checked) => set("use_tls", checked)}
                  />
                  <Label htmlFor="smtp-tls">STARTTLS</Label>
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    id="smtp-ssl"
                    checked={draft.use_ssl}
                    onCheckedChange={(checked) => set("use_ssl", checked)}
                  />
                  <Label htmlFor="smtp-ssl">Implicit SSL</Label>
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    id="smtp-active"
                    checked={draft.is_active}
                    onCheckedChange={(checked) => set("is_active", checked)}
                  />
                  <Label htmlFor="smtp-active">Enabled</Label>
                </div>
              </div>

              <Separator />

              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-muted-foreground">
                  TLS and SSL are mutually exclusive transports.
                </p>
                <Button onClick={() => void save()} disabled={!dirty || update.isPending}>
                  {update.isPending ? (
                    <>
                      <Loader2 className="size-4 animate-spin" />
                      Saving…
                    </>
                  ) : (
                    <>
                      <Save className="size-4" />
                      Save configuration
                    </>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>

          <div className="space-y-5">
            <Card>
              <CardHeader>
                <CardTitle>Credential status</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Password present</span>
                  {config.has_password ? (
                    <Badge variant="success">Detected</Badge>
                  ) : (
                    <Badge variant="destructive">Missing</Badge>
                  )}
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">Environment variable</span>
                  <code className="text-xs">{config.password_env_var}</code>
                </div>
                <p className="text-xs text-muted-foreground">
                  Set the variable on the server and restart the API process. The UI
                  never receives the value.
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Send a test email</CardTitle>
                <CardDescription>
                  Uses the saved configuration; unsaved edits are ignored.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="test-email">Recipient</Label>
                  <Input
                    id="test-email"
                    type="email"
                    placeholder="Defaults to your account email"
                    value={testAddress}
                    onChange={(event) => setTestAddress(event.target.value)}
                  />
                </div>
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => void sendTest()}
                  disabled={test.isPending}
                >
                  {test.isPending ? (
                    <>
                      <Loader2 className="size-4 animate-spin" />
                      Sending…
                    </>
                  ) : (
                    <>
                      <Send className="size-4" />
                      Send test
                    </>
                  )}
                </Button>
                {lastTest ? (
                  <p className="text-xs text-muted-foreground">{lastTest}</p>
                ) : null}
              </CardContent>
            </Card>
          </div>
        </div>
      </Can>
    </div>
  )
}
