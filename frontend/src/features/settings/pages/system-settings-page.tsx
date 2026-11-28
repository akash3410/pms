import { Loader2, Save, Settings } from "lucide-react"
import * as React from "react"
import { toast } from "sonner"

import { Can, useAccess } from "@/app/access"
import { ErrorState, LoadingState } from "@/components/feedback/states"
import { PageHeader } from "@/components/layout/page-header"
import {
  Alert,
  AlertDescription,
  Separator,
  Switch,
} from "@/components/ui/misc"
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
  useSystemSettings,
  useUpdateSystemSettings,
} from "@/features/settings/hooks"
import { normalizeError } from "@/lib/api/errors"

export function SystemSettingsPage() {
  const { isSuperuser } = useAccess()
  const query = useSystemSettings(true)
  const update = useUpdateSystemSettings()

  const [hours, setHours] = React.useState("")
  const [requireVerification, setRequireVerification] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [dirty, setDirty] = React.useState(false)

  React.useEffect(() => {
    if (!query.data) return
    setHours(String(query.data.invitation_expiry_hours))
    setRequireVerification(query.data.require_email_verification)
    setDirty(false)
  }, [query.data])

  if (query.isPending) return <LoadingState label="Loading system settings…" />
  if (query.isError) {
    return (
      <div className="space-y-4">
        <PageHeader title="System settings" crumbs={[{ label: "System settings" }]} />
        <ErrorState
          error={query.error}
          title="Could not load system settings"
          onRetry={() => void query.refetch()}
        />
      </div>
    )
  }

  const max = query.data.max_invitation_expiry_hours
  const parsedHours = Number(hours)
  const hoursValid =
    Number.isInteger(parsedHours) && parsedHours >= 1 && parsedHours <= max

  const save = async () => {
    setError(null)
    try {
      await update.mutateAsync({
        invitation_expiry_hours: parsedHours,
        require_email_verification: requireVerification,
      })
      toast.success("System settings saved.")
      setDirty(false)
    } catch (caught) {
      setError(normalizeError(caught).detail)
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="System settings"
        description="Installation-wide policy. These endpoints accept no role grant — only a superuser can reach them."
        crumbs={[{ label: "System settings" }]}
        actions={
          isSuperuser ? <Badge variant="info">Superuser</Badge> : null
        }
      />

      <Alert>
        <Settings />
        <AlertDescription>
          Values are stored server-side and audited. Changing the invitation lifetime
          never affects invitations that were already sent.
        </AlertDescription>
      </Alert>

      <Can permission="system.manage_settings">
        <Card>
          <CardHeader>
            <CardTitle>Access policy</CardTitle>
            <CardDescription>
              Applies to every new account and invitation created from now on.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {error ? (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="system-expiry">Invitation lifetime (hours)</Label>
                <Input
                  id="system-expiry"
                  type="number"
                  min={1}
                  max={max}
                  value={hours}
                  onChange={(event) => {
                    setHours(event.target.value)
                    setDirty(true)
                  }}
                  aria-invalid={!hoursValid}
                />
                <p className="text-xs text-muted-foreground">
                  Between 1 and {max} hours ({Math.round(max / 24)} days).
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="system-verification">Require email verification</Label>
                <div className="flex items-center gap-2">
                  <Switch
                    id="system-verification"
                    checked={requireVerification}
                    onCheckedChange={(checked) => {
                      setRequireVerification(checked)
                      setDirty(true)
                    }}
                  />
                  <span className="text-sm text-muted-foreground">
                    {requireVerification
                      ? "Unverified accounts cannot sign in."
                      : "Unverified accounts may sign in."}
                  </span>
                </div>
              </div>
            </div>

            <Separator />

            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">
                Changes take effect immediately and are recorded in the audit log.
              </p>
              <Button
                onClick={() => void save()}
                disabled={!dirty || !hoursValid || update.isPending}
              >
                {update.isPending ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Saving…
                  </>
                ) : (
                  <>
                    <Save className="size-4" />
                    Save settings
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      </Can>
    </div>
  )
}
