import { Loader2, Mail, Plus, Send, Settings2, XCircle } from "lucide-react"
import * as React from "react"
import { useSearchParams } from "react-router-dom"
import { toast } from "sonner"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import { z } from "zod"

import { Can } from "@/app/access"
import { EmptyState, ErrorState, TableSkeleton } from "@/components/feedback/states"
import { PageHeader } from "@/components/layout/page-header"
import { ConfirmDialog } from "@/components/shared/confirm-dialog"
import { FormField } from "@/components/shared/form-field"
import { FilterSelect, SearchInput, Toolbar } from "@/components/shared/list-toolbar"
import { DataPagination } from "@/components/shared/pagination"
import { Alert, AlertDescription, Checkbox, Separator } from "@/components/ui/misc"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  useCancelInvitation,
  useCreateInvitation,
  useInvitationSettings,
  useInvitations,
  useResendInvitation,
  useUpdateInvitationSettings,
} from "@/features/invitations/hooks"
import {
  INVITATION_STATUSES,
  type Invitation,
  type InvitationStatus,
} from "@/features/invitations/types"
import { useRoles } from "@/features/rbac/hooks"
import { normalizeError } from "@/lib/api/errors"
import { formatDate, formatDateTime } from "@/lib/format"

type BadgeTone = "success" | "warning" | "neutral" | "destructive"

const STATUS_VARIANT: Record<InvitationStatus, BadgeTone> = {
  PENDING: "warning",
  ACCEPTED: "success",
  CANCELLED: "neutral",
  EXPIRED: "destructive",
}

const createSchema = z.object({
  email: z.email("Enter a valid email address."),
  full_name: z.string().trim().max(150).optional(),
  employee_code: z.string().trim().max(40).optional(),
  role_ids: z.array(z.string()),
})
type CreateValues = z.infer<typeof createSchema>

function CreateInvitationDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const create = useCreateInvitation()
  const roles = useRoles({ page_size: 200, is_active: true, ordering: "name" })
  const [formError, setFormError] = React.useState<string | null>(null)
  const form = useForm<CreateValues>({
    resolver: zodResolver(createSchema),
    values: {
      email: "",
      full_name: "",
      employee_code: "",
      role_ids: [],
    },
  })

  React.useEffect(() => {
    if (open) {
      form.reset({ email: "", full_name: "", employee_code: "", role_ids: [] })
      setFormError(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null)
    try {
      await create.mutateAsync({
        email: values.email,
        full_name: values.full_name,
        employee_code: values.employee_code,
        roles: values.role_ids,
      })
      toast.success("Invitation sent.")
      onOpenChange(false)
    } catch (error) {
      const apiError = normalizeError(error)
      setFormError(apiError.detail)
      for (const [field, messages] of Object.entries(apiError.fieldErrors)) {
        if (field === "email" || field === "full_name" || field === "employee_code") {
          form.setError(field, { message: messages.join(" ") })
        }
      }
    }
  })

  const selected = form.watch("role_ids")

  return (
    <Dialog open={open} onOpenChange={(next) => !create.isPending && onOpenChange(next)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Invite an employee</DialogTitle>
          <DialogDescription>
            The recipient receives an email with a one-time link. Roles chosen here
            are assigned when the invitation is accepted.
          </DialogDescription>
        </DialogHeader>

        {formError ? (
          <Alert variant="destructive">
            <AlertDescription>{formError}</AlertDescription>
          </Alert>
        ) : null}

        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <FormField
            id="invite_email"
            label="Email"
            required
            error={form.formState.errors.email?.message}
          >
            <Input id="invite_email" type="email" autoFocus {...form.register("email")} />
          </FormField>

          <div className="grid gap-3 sm:grid-cols-2">
            <FormField
              id="invite_name"
              label="Full name"
              error={form.formState.errors.full_name?.message}
            >
              <Input id="invite_name" {...form.register("full_name")} />
            </FormField>
            <FormField
              id="invite_code"
              label="Employee code"
              error={form.formState.errors.employee_code?.message}
            >
              <Input id="invite_code" {...form.register("employee_code")} />
            </FormField>
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Roles</legend>
            <p className="text-xs text-muted-foreground">
              Optional. An invitation with no roles creates an account without
              permissions.
            </p>
            {roles.isPending ? (
              <p className="text-xs text-muted-foreground">Loading roles…</p>
            ) : (
              <div className="max-h-48 space-y-1.5 overflow-y-auto rounded-lg border border-border p-2">
                {(roles.data?.results ?? []).map((role) => {
                  const checked = selected.includes(role.id)
                  return (
                    <label
                      key={role.id}
                      className="flex items-center gap-2 rounded px-1 py-1 text-sm hover:bg-muted"
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(next) =>
                          form.setValue(
                            "role_ids",
                            next === true
                              ? [...selected, role.id]
                              : selected.filter((id) => id !== role.id),
                            { shouldDirty: true },
                          )
                        }
                      />
                      <span>{role.name}</span>
                      <code className="text-xs text-muted-foreground">{role.code}</code>
                    </label>
                  )
                })}
              </div>
            )}
          </fieldset>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={create.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Sending…
                </>
              ) : (
                "Send invitation"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function InvitationSettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const settings = useInvitationSettings(open)
  const update = useUpdateInvitationSettings()
  const [hours, setHours] = React.useState("")

  React.useEffect(() => {
    if (settings.data) setHours(String(settings.data.invitation_expiry_hours))
  }, [settings.data])

  const max = settings.data?.max_invitation_expiry_hours ?? 168
  const parsed = Number(hours)
  const valid = Number.isInteger(parsed) && parsed >= 1 && parsed <= max

  return (
    <Dialog open={open} onOpenChange={(next) => !update.isPending && onOpenChange(next)}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Invitation lifetime</DialogTitle>
          <DialogDescription>
            Applies to invitations created after saving. Existing invitations keep
            the expiry they were created with.
          </DialogDescription>
        </DialogHeader>

        {settings.isError ? (
          <Alert variant="destructive">
            <AlertDescription>{normalizeError(settings.error).detail}</AlertDescription>
          </Alert>
        ) : null}

        <div className="space-y-1.5">
          <Label htmlFor="expiry-hours">Hours until expiry</Label>
          <Input
            id="expiry-hours"
            type="number"
            min={1}
            max={max}
            value={hours}
            onChange={(event) => setHours(event.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Between 1 and {max} hours.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={update.isPending}>
            Cancel
          </Button>
          <Button
            disabled={!valid || update.isPending}
            onClick={async () => {
              try {
                await update.mutateAsync(parsed)
                toast.success("Invitation lifetime updated.")
                onOpenChange(false)
              } catch (error) {
                toast.error(normalizeError(error).detail)
              }
            }}
          >
            {update.isPending ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Saving…
              </>
            ) : (
              "Save"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function InvitationsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [createOpen, setCreateOpen] = React.useState(false)
  const [settingsOpen, setSettingsOpen] = React.useState(false)
  const [cancelling, setCancelling] = React.useState<Invitation | null>(null)

  const page = Math.max(1, Number(searchParams.get("page") ?? "1"))
  const pageSize = [10, 20, 50].includes(Number(searchParams.get("page_size")))
    ? Number(searchParams.get("page_size"))
    : 20
  const search = searchParams.get("search") ?? ""
  const status = searchParams.get("status") as InvitationStatus | null

  const query = useInvitations({
    page,
    page_size: pageSize,
    search: search || undefined,
    status: status ?? undefined,
    ordering: "-created_at",
  })
  const resend = useResendInvitation()
  const cancel = useCancelInvitation()

  const updateParams = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams(searchParams)
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined || value === "") next.delete(key)
      else next.set(key, value)
    }
    if (!("page" in patch)) next.delete("page")
    setSearchParams(next, { replace: true })
  }

  const rows = query.data?.results ?? []

  return (
    <div className="space-y-5">
      <PageHeader
        title="Invitations"
        description="Invite employees by email. Each invitation carries its own expiry snapshot and optional roles."
        crumbs={[{ label: "Invitations" }]}
        actions={
          <>
            <Can permission="invitations.manage_settings">
              <Button variant="outline" onClick={() => setSettingsOpen(true)}>
                <Settings2 className="size-4" />
                Invitation settings
              </Button>
            </Can>
            <Can permission="invitations.create_invitation">
              <Button onClick={() => setCreateOpen(true)}>
                <Plus className="size-4" />
                Invite employee
              </Button>
            </Can>
          </>
        }
      />

      <Card className="gap-0 overflow-hidden py-0">
        <Toolbar>
          <SearchInput
            value={search}
            onChange={(value) => updateParams({ search: value || undefined })}
            placeholder="Email, name or employee code…"
            label="Search invitations"
          />
          <FilterSelect
            label="Filter by status"
            placeholder="Status"
            value={status ?? undefined}
            onChange={(value) => updateParams({ status: value })}
            options={INVITATION_STATUSES.map((item) => ({
              value: item.value,
              label: item.label,
            }))}
          />
        </Toolbar>

        {query.isPending ? (
          <TableSkeleton rows={5} columns={5} />
        ) : query.isError ? (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={Mail}
            title="No invitations"
            description="Invite an employee to create their account."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Recipient</TableHead>
                <TableHead>Roles</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead>Sent</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((invitation) => (
                <TableRow key={invitation.id}>
                  <TableCell>
                    <p className="font-medium">{invitation.email}</p>
                    <p className="text-xs text-muted-foreground">
                      {[invitation.full_name, invitation.employee_code]
                        .filter(Boolean)
                        .join(" · ") || "—"}
                    </p>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {invitation.roles.length === 0 ? (
                        <span className="text-xs text-muted-foreground">None</span>
                      ) : (
                        invitation.roles.map((role) => (
                          <Badge key={role.id} variant="outline">
                            {role.code}
                          </Badge>
                        ))
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[invitation.status]}>
                      {invitation.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {formatDate(invitation.expires_at)}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {invitation.last_sent_at
                      ? `${formatDateTime(invitation.last_sent_at)} · ${invitation.send_count}×`
                      : "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    {invitation.status === "PENDING" ? (
                      <div className="flex justify-end gap-1">
                        <Can permission="invitations.resend_invitation">
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={resend.isPending}
                            onClick={async () => {
                              try {
                                await resend.mutateAsync(invitation.id)
                                toast.success("Invitation re-sent.")
                              } catch (error) {
                                toast.error(normalizeError(error).detail)
                              }
                            }}
                          >
                            <Send className="size-4" />
                            Resend
                          </Button>
                        </Can>
                        <Can permission="invitations.cancel_invitation">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setCancelling(invitation)}
                          >
                            <XCircle className="size-4" />
                            Cancel
                          </Button>
                        </Can>
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        {invitation.accepted_at
                          ? `Accepted ${formatDate(invitation.accepted_at)}`
                          : invitation.cancelled_at
                            ? `Cancelled ${formatDate(invitation.cancelled_at)}`
                            : "No actions"}
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        {query.data && query.data.count > 0 ? (
          <DataPagination
            page={page}
            pageSize={pageSize}
            count={query.data.count}
            pageSizeOptions={[10, 20, 50]}
            onPageChange={(next) => updateParams({ page: String(next) })}
            onPageSizeChange={(size) =>
              updateParams({ page_size: String(size), page: "1" })
            }
          />
        ) : null}
      </Card>

      <Can permission="invitations.create_invitation">
        <CreateInvitationDialog open={createOpen} onOpenChange={setCreateOpen} />
      </Can>

      <Can permission="invitations.manage_settings">
        <InvitationSettingsDialog
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
        />
      </Can>

      {cancelling ? (
        <ConfirmDialog
          open
          onOpenChange={(next) => !next && setCancelling(null)}
          title="Cancel this invitation?"
          destructive
          confirmLabel="Cancel invitation"
          pending={cancel.isPending}
          description={
            <>
              <p>
                The link sent to <strong>{cancelling.email}</strong> stops working
                immediately. The record is kept for audit purposes.
              </p>
              <Separator className="my-2" />
              <p className="text-xs">
                You can send a new invitation to the same address afterwards.
              </p>
            </>
          }
          onConfirm={async () => {
            try {
              await cancel.mutateAsync(cancelling.id)
              toast.success("Invitation cancelled.")
              setCancelling(null)
            } catch (error) {
              toast.error(normalizeError(error).detail)
            }
          }}
        />
      ) : null}
    </div>
  )
}
