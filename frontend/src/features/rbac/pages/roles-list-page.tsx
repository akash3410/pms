import { Loader2, Plus, ShieldCheck, Trash2 } from "lucide-react"
import * as React from "react"
import { Link, useSearchParams } from "react-router-dom"
import { toast } from "sonner"

import { Can, useAccess } from "@/app/access"
import { EmptyState, ErrorState, TableSkeleton } from "@/components/feedback/states"
import { PageHeader } from "@/components/layout/page-header"
import { ConfirmDialog } from "@/components/shared/confirm-dialog"
import { FormField } from "@/components/shared/form-field"
import { FilterSelect, SearchInput, Toolbar } from "@/components/shared/list-toolbar"
import { DataPagination } from "@/components/shared/pagination"
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
import { Textarea } from "@/components/ui/textarea"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  useCreateRole,
  useDeleteRole,
  useRoles,
  useSetRoleActive,
} from "@/features/rbac/hooks"
import type { Role } from "@/features/rbac/types"
import { normalizeError } from "@/lib/api/errors"
import { formatDate } from "@/lib/format"
import { z } from "zod"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"

const createSchema = z.object({
  name: z.string().trim().min(1, "Role name is required.").max(80),
  code: z
    .string()
    .trim()
    .max(64)
    .regex(/^[A-Za-z0-9_]*$/, "Use letters, digits and underscores only.")
    .optional(),
  description: z.string().max(500).optional(),
})
type CreateValues = z.infer<typeof createSchema>

function CreateRoleDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const createRole = useCreateRole()
  const [formError, setFormError] = React.useState<string | null>(null)
  const form = useForm<CreateValues>({
    resolver: zodResolver(createSchema),
    defaultValues: { name: "", code: "", description: "" },
  })

  React.useEffect(() => {
    if (open) {
      form.reset({ name: "", code: "", description: "" })
      setFormError(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null)
    try {
      const role = await createRole.mutateAsync({
        name: values.name,
        description: values.description,
        ...(values.code ? { code: values.code } : {}),
      })
      toast.success(`Role ${role.code} created.`)
      onOpenChange(false)
    } catch (error) {
      const apiError = normalizeError(error)
      setFormError(apiError.detail)
      for (const [field, messages] of Object.entries(apiError.fieldErrors)) {
        if (field === "name" || field === "code" || field === "description") {
          form.setError(field, { message: messages.join(" ") })
        }
      }
    }
  })

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !createRole.isPending && onOpenChange(next)}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New role</DialogTitle>
          <DialogDescription>
            New roles start with no permissions. Grant them after creating the role.
          </DialogDescription>
        </DialogHeader>

        {formError ? (
          <p role="alert" className="text-xs font-medium text-destructive">
            {formError}
          </p>
        ) : null}

        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <FormField
            id="role_name"
            label="Name"
            required
            error={form.formState.errors.name?.message}
          >
            <Input id="role_name" autoFocus {...form.register("name")} />
          </FormField>

          <FormField
            id="role_code"
            label="Code"
            error={form.formState.errors.code?.message}
            description="Optional. Defaults to a slug of the name; codes are stable."
          >
            <Input id="role_code" placeholder="SUPERVISOR" {...form.register("code")} />
          </FormField>

          <FormField
            id="role_description"
            label="Description"
            error={form.formState.errors.description?.message}
          >
            <Textarea id="role_description" rows={3} {...form.register("description")} />
          </FormField>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={createRole.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={createRole.isPending}>
              {createRole.isPending ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Creating…
                </>
              ) : (
                "Create role"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function RolesListPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const { can } = useAccess()
  const [createOpen, setCreateOpen] = React.useState(false)
  const [deleting, setDeleting] = React.useState<Role | null>(null)

  const page = Math.max(1, Number(searchParams.get("page") ?? "1"))
  const pageSize = [10, 20, 50].includes(Number(searchParams.get("page_size")))
    ? Number(searchParams.get("page_size"))
    : 20
  const search = searchParams.get("search") ?? ""
  // `searchParams.get` yields `null` when absent — normalise before comparing.
  const status = searchParams.get("is_active") ?? undefined

  const params = {
    page,
    page_size: pageSize,
    search: search || undefined,
    ordering: "name",
    is_active: status === undefined ? undefined : status === "true",
  }

  const query = useRoles(params)
  const setActive = useSetRoleActive()
  const deleteRole = useDeleteRole()

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
        title="Roles"
        description="Roles are permission bundles. Authorization is resolved from a user's roles on every request — nothing is hardcoded in the client."
        crumbs={[{ label: "Roles" }]}
        actions={
          <Can permission="roles.manage_roles">
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="size-4" />
              New role
            </Button>
          </Can>
        }
      />

      <Card className="gap-0 overflow-hidden py-0">
        <Toolbar>
          <SearchInput
            value={search}
            onChange={(value) => updateParams({ search: value || undefined })}
            placeholder="Code, name or description…"
            label="Search roles"
          />
          <FilterSelect
            label="Filter by status"
            placeholder="Status"
            value={status ?? undefined}
            onChange={(value) => updateParams({ is_active: value })}
            options={[
              { value: "true", label: "Active" },
              { value: "false", label: "Inactive" },
            ]}
          />
        </Toolbar>

        {query.isPending ? (
          <TableSkeleton rows={5} columns={4} />
        ) : query.isError ? (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={ShieldCheck}
            title="No roles found"
            description="Create a role to start bundling permissions."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Role</TableHead>
                <TableHead>Permissions</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((role) => (
                <TableRow key={role.id}>
                  <TableCell>
                    <Link
                      to={`/admin/roles/${role.id}`}
                      className="font-medium text-primary hover:underline"
                    >
                      {role.name}
                    </Link>
                    <div className="flex items-center gap-1.5">
                      <code className="text-xs text-muted-foreground">{role.code}</code>
                      {role.is_system ? (
                        <Badge variant="outline">System</Badge>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm tabular">
                    {role.permissions.length}
                  </TableCell>
                  <TableCell>
                    <Badge variant={role.is_active ? "success" : "neutral"}>
                      {role.is_active ? "Active" : "Inactive"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {formatDate(role.created_at)}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      {can("roles.manage_roles") ? (
                        <>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={setActive.isPending}
                            onClick={async () => {
                              try {
                                await setActive.mutateAsync({
                                  id: role.id,
                                  active: !role.is_active,
                                })
                                toast.success(
                                  `Role ${role.code} ${role.is_active ? "deactivated" : "activated"}.`,
                                )
                              } catch (error) {
                                toast.error(normalizeError(error).detail)
                              }
                            }}
                          >
                            {role.is_active ? "Deactivate" : "Activate"}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setDeleting(role)}
                          >
                            <Trash2 className="size-4" />
                            Delete
                          </Button>
                        </>
                      ) : (
                        <Button variant="ghost" size="sm" asChild>
                          <Link to={`/admin/roles/${role.id}`}>View</Link>
                        </Button>
                      )}
                    </div>
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

      <Can permission="roles.manage_roles">
        <CreateRoleDialog open={createOpen} onOpenChange={setCreateOpen} />
      </Can>

      {deleting ? (
        <ConfirmDialog
          open
          onOpenChange={(next) => !next && setDeleting(null)}
          title={`Delete role ${deleting.code}?`}
          destructive
          confirmLabel="Delete role"
          pending={deleteRole.isPending}
          description={
            <>
              <p>
                The role and its permission grants are removed permanently. This
                cannot be undone.
              </p>
              <p>
                The backend refuses to delete a role that is still assigned to users
                or referenced elsewhere — revoke those assignments first.
              </p>
            </>
          }
          onConfirm={async () => {
            try {
              await deleteRole.mutateAsync(deleting.id)
              toast.success(`Role ${deleting.code} deleted.`)
              setDeleting(null)
            } catch (error) {
              toast.error(normalizeError(error).detail)
            }
          }}
        />
      ) : null}
    </div>
  )
}
