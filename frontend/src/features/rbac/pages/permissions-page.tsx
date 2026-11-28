import { KeyRound, Loader2, Plus } from "lucide-react"
import * as React from "react"
import { useSearchParams } from "react-router-dom"
import { toast } from "sonner"

import { Can, useAccess } from "@/app/access"
import { EmptyState, ErrorState, TableSkeleton } from "@/components/feedback/states"
import { PageHeader } from "@/components/layout/page-header"
import { FormField } from "@/components/shared/form-field"
import {
  ClearFiltersButton,
  FilterSelect,
  SearchInput,
  Toolbar,
} from "@/components/shared/list-toolbar"
import { DataPagination } from "@/components/shared/pagination"
import { Alert, AlertDescription } from "@/components/ui/misc"
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
  useCreatePermission,
  usePermissionCatalogue,
  usePermissions,
  useSetPermissionActive,
  useUpdatePermission,
} from "@/features/rbac/hooks"
import type { Permission } from "@/features/rbac/types"
import { normalizeError } from "@/lib/api/errors"
import { formatDateTime, humanize } from "@/lib/format"
import { SCOPE_TYPES, type ScopeType } from "@/lib/api/types"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import { z } from "zod"

const schema = z.object({
  key: z
    .string()
    .trim()
    .min(1, "Key is required.")
    .regex(/^[a-z0-9_]+\.[a-z0-9_]+$/, "Use 'module.action' in lower-case."),
  name: z.string().trim().min(1, "Name is required.").max(120),
  description: z.string().max(500).optional(),
  supported_scopes: z
    .array(z.custom<ScopeType>())
    .min(1, "Choose at least one supported scope."),
})
type FormValues = z.infer<typeof schema>

function PermissionDialog({
  open,
  onOpenChange,
  permission,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  permission?: Permission
}) {
  const create = useCreatePermission()
  const update = useUpdatePermission()
  const [formError, setFormError] = React.useState<string | null>(null)
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    values: {
      key: permission?.key ?? "",
      name: permission?.name ?? "",
      description: permission?.description ?? "",
      supported_scopes: permission?.supported_scopes ?? ["ALL"],
    },
  })

  const pending = create.isPending || update.isPending

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null)
    try {
      // `key` is immutable: the backend rejects a changed key on update.
      if (permission) {
        await update.mutateAsync({
          id: permission.id,
          input: {
            name: values.name,
            description: values.description,
            supported_scopes: values.supported_scopes,
          },
        })
        toast.success("Permission updated.")
      } else {
        await create.mutateAsync(values)
        toast.success("Permission created.")
      }
      onOpenChange(false)
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

  const selectedScopes = form.watch("supported_scopes") ?? []

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{permission ? "Edit permission" : "New permission"}</DialogTitle>
          <DialogDescription>
            Permission keys are permanent. Custom keys are only meaningful if the
            backend already enforces them in the matching module.
          </DialogDescription>
        </DialogHeader>

        {formError ? (
          <Alert variant="destructive">
            <AlertDescription>{formError}</AlertDescription>
          </Alert>
        ) : null}

        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <FormField
            id="perm_key"
            label="Key"
            required
            error={form.formState.errors.key?.message}
            description="Format: module.action, e.g. orders.export_orders."
          >
            <Input
              id="perm_key"
              disabled={Boolean(permission)}
              placeholder="orders.export_orders"
              {...form.register("key")}
            />
          </FormField>

          <FormField
            id="perm_name"
            label="Display name"
            required
            error={form.formState.errors.name?.message}
          >
            <Input id="perm_name" {...form.register("name")} />
          </FormField>

          <FormField
            id="perm_description"
            label="Description"
            error={form.formState.errors.description?.message}
          >
            <Textarea id="perm_description" rows={2} {...form.register("description")} />
          </FormField>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Supported scopes</legend>
            <p className="text-xs text-muted-foreground">
              Only these scope types may be granted when assigning the permission.
            </p>
            <div className="flex flex-wrap gap-2">
              {SCOPE_TYPES.map((scope) => {
                const active = selectedScopes.includes(scope.value)
                return (
                  <button
                    key={scope.value}
                    type="button"
                    aria-pressed={active}
                    title={scope.description}
                    onClick={() =>
                      form.setValue(
                        "supported_scopes",
                        active
                          ? selectedScopes.filter((item) => item !== scope.value)
                          : [...selectedScopes, scope.value],
                        { shouldValidate: true, shouldDirty: true },
                      )
                    }
                    className={
                      active
                        ? "rounded-md border border-primary bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary"
                        : "rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted"
                    }
                  >
                    {scope.label}
                  </button>
                )
              })}
            </div>
            {form.formState.errors.supported_scopes ? (
              <p role="alert" className="text-xs font-medium text-destructive">
                {form.formState.errors.supported_scopes.message}
              </p>
            ) : null}
          </fieldset>

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
              ) : permission ? (
                "Save changes"
              ) : (
                "Create permission"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function PermissionsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const { can } = useAccess()
  const [createOpen, setCreateOpen] = React.useState(false)
  const [editing, setEditing] = React.useState<Permission | null>(null)

  const page = Math.max(1, Number(searchParams.get("page") ?? "1"))
  const pageSize = [20, 50, 100].includes(Number(searchParams.get("page_size")))
    ? Number(searchParams.get("page_size"))
    : 20
  const search = searchParams.get("search") ?? ""
  const module = searchParams.get("module") ?? undefined

  const catalogue = usePermissionCatalogue()
  const modules = Array.from(
    new Set((catalogue.data ?? []).map((permission) => permission.module)),
  ).sort()

  const query = usePermissions({
    page,
    page_size: pageSize,
    search: search || undefined,
    module,
    ordering: "module",
  })
  const setActive = useSetPermissionActive()

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
  const canManage = can("permissions.manage_permissions")

  return (
    <div className="space-y-5">
      <PageHeader
        title="Permissions"
        description="The catalogue the backend enforces. Roles grant these keys at a scope; scopes limit which records they reach."
        crumbs={[{ label: "Permissions" }]}
        actions={
          <Can permission="permissions.manage_permissions">
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="size-4" />
              New permission
            </Button>
          </Can>
        }
      />

      <Card className="gap-0 overflow-hidden py-0">
        <Toolbar>
          <SearchInput
            value={search}
            onChange={(value) => updateParams({ search: value || undefined })}
            placeholder="Key, name or description…"
            label="Search permissions"
          />
          <FilterSelect
            label="Filter by module"
            placeholder="Module"
            value={module}
            onChange={(value) => updateParams({ module: value })}
            options={modules.map((item) => ({ value: item, label: humanize(item) }))}
          />
          <ClearFiltersButton
            active={Boolean(search || module)}
            onClear={() => setSearchParams(new URLSearchParams(), { replace: true })}
          />
        </Toolbar>

        {query.isPending ? (
          <TableSkeleton rows={8} columns={5} />
        ) : query.isError ? (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={KeyRound}
            title="No permissions match"
            description="Adjust the filters or search term."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Permission</TableHead>
                <TableHead>Module</TableHead>
                <TableHead>Supported scopes</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Updated</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((permission) => (
                <TableRow key={permission.id}>
                  <TableCell>
                    <p className="font-medium">{permission.name}</p>
                    <code className="text-xs text-muted-foreground">{permission.key}</code>
                  </TableCell>
                  <TableCell className="text-sm">{humanize(permission.module)}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {permission.supported_scopes.map((scope) => (
                        <Badge key={scope} variant="outline">
                          {humanize(scope)}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      <Badge variant={permission.is_active ? "success" : "neutral"}>
                        {permission.is_active ? "Active" : "Inactive"}
                      </Badge>
                      {permission.is_system ? (
                        <Badge variant="info">System</Badge>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {formatDateTime(permission.updated_at)}
                  </TableCell>
                  <TableCell className="text-right">
                    {canManage ? (
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setEditing(permission)}
                        >
                          Edit
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={setActive.isPending}
                          onClick={async () => {
                            try {
                              await setActive.mutateAsync({
                                id: permission.id,
                                active: !permission.is_active,
                              })
                              toast.success(
                                `${permission.key} ${permission.is_active ? "deactivated" : "activated"}.`,
                              )
                            } catch (error) {
                              toast.error(normalizeError(error).detail)
                            }
                          }}
                        >
                          {permission.is_active ? "Deactivate" : "Activate"}
                        </Button>
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">Read only</span>
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
            pageSizeOptions={[20, 50, 100]}
            onPageChange={(next) => updateParams({ page: String(next) })}
            onPageSizeChange={(size) =>
              updateParams({ page_size: String(size), page: "1" })
            }
          />
        ) : null}
      </Card>

      <Can permission="permissions.manage_permissions">
        <PermissionDialog open={createOpen} onOpenChange={setCreateOpen} />
      </Can>

      {editing ? (
        <PermissionDialog
          open
          onOpenChange={(next) => !next && setEditing(null)}
          permission={editing}
        />
      ) : null}
    </div>
  )
}
