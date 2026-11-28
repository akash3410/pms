import { Building2, Loader2, Plus } from "lucide-react"
import * as React from "react"
import { Link, useSearchParams } from "react-router-dom"
import { toast } from "sonner"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import { z } from "zod"

import { Can, useAccess } from "@/app/access"
import { EmptyState, ErrorState, TableSkeleton } from "@/components/feedback/states"
import { PageHeader } from "@/components/layout/page-header"
import { FormField } from "@/components/shared/form-field"
import { FilterSelect, SearchInput, Toolbar } from "@/components/shared/list-toolbar"
import { DataPagination } from "@/components/shared/pagination"
import { Alert, AlertDescription, Checkbox } from "@/components/ui/misc"
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
import { Textarea } from "@/components/ui/textarea"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { useCreateDepartment, useDepartments } from "@/features/rbac/hooks"
import { normalizeError } from "@/lib/api/errors"
import { formatDate } from "@/lib/format"

const schema = z.object({
  code: z
    .string()
    .trim()
    .min(1, "Code is required.")
    .max(32)
    .regex(/^[A-Za-z0-9_]+$/, "Use letters, digits and underscores."),
  name: z.string().trim().min(1, "Name is required.").max(80),
  description: z.string().max(500).optional(),
  is_production: z.boolean(),
})
type FormValues = z.infer<typeof schema>

function CreateDepartmentDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const create = useCreateDepartment()
  const [formError, setFormError] = React.useState<string | null>(null)
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      code: "",
      name: "",
      description: "",
      is_production: true,
    },
  })

  React.useEffect(() => {
    if (open) {
      form.reset({ code: "", name: "", description: "", is_production: true })
      setFormError(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null)
    try {
      const department = await create.mutateAsync(values)
      toast.success(`Department ${department.code} created.`)
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

  return (
    <Dialog open={open} onOpenChange={(next) => !create.isPending && onOpenChange(next)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New department</DialogTitle>
          <DialogDescription>
            Production departments take part in the order workflow. Codes are
            permanent once created.
          </DialogDescription>
        </DialogHeader>

        {formError ? (
          <Alert variant="destructive">
            <AlertDescription>{formError}</AlertDescription>
          </Alert>
        ) : null}

        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <FormField
            id="dept_name"
            label="Name"
            required
            error={form.formState.errors.name?.message}
          >
            <Input id="dept_name" autoFocus {...form.register("name")} />
          </FormField>

          <FormField
            id="dept_code"
            label="Code"
            required
            error={form.formState.errors.code?.message}
            description="Upper-cased by the backend. Cannot be changed later."
          >
            <Input id="dept_code" placeholder="FINISHING" {...form.register("code")} />
          </FormField>

          <FormField
            id="dept_description"
            label="Description"
            error={form.formState.errors.description?.message}
          >
            <Textarea id="dept_description" rows={2} {...form.register("description")} />
          </FormField>

          <div className="flex items-start gap-2">
            <Checkbox
              id="dept_production"
              checked={form.watch("is_production")}
              onCheckedChange={(checked) =>
                form.setValue("is_production", checked === true)
              }
            />
            <div>
              <Label htmlFor="dept_production">Production department</Label>
              <p className="text-xs text-muted-foreground">
                Only production departments appear in production reports and order
                workflows.
              </p>
            </div>
          </div>

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
                  Creating…
                </>
              ) : (
                "Create department"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function DepartmentsListPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const { can } = useAccess()
  const [createOpen, setCreateOpen] = React.useState(false)

  const page = Math.max(1, Number(searchParams.get("page") ?? "1"))
  const pageSize = [10, 20, 50].includes(Number(searchParams.get("page_size")))
    ? Number(searchParams.get("page_size"))
    : 20
  const search = searchParams.get("search") ?? ""
  // `searchParams.get` yields `null` when absent — normalise before comparing.
  const activeFilter = searchParams.get("is_active") ?? undefined

  const query = useDepartments({
    page,
    page_size: pageSize,
    search: search || undefined,
    is_active: activeFilter === undefined ? undefined : activeFilter === "true",
  })

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
  const canManage = can("departments.manage_departments")

  return (
    <div className="space-y-5">
      <PageHeader
        title="Departments"
        description="Departments scope production work and department-level data access."
        crumbs={[{ label: "Departments" }]}
        actions={
          <Can permission="departments.manage_departments">
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="size-4" />
              New department
            </Button>
          </Can>
        }
      />

      <Card className="gap-0 overflow-hidden py-0">
        <Toolbar>
          <SearchInput
            value={search}
            onChange={(value) => updateParams({ search: value || undefined })}
            placeholder="Code or name…"
            label="Search departments"
          />
          <FilterSelect
            label="Filter by status"
            placeholder="Status"
            value={activeFilter ?? undefined}
            onChange={(value) => updateParams({ is_active: value })}
            options={[
              { value: "true", label: "Active" },
              { value: "false", label: "Inactive" },
            ]}
          />
        </Toolbar>

        {query.isPending ? (
          <TableSkeleton rows={4} columns={4} />
        ) : query.isError ? (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={Building2}
            title="No departments found"
            description="Create a department to scope production work."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Department</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((department) => (
                <TableRow key={department.id}>
                  <TableCell>
                    <Link
                      to={`/admin/departments/${department.id}`}
                      className="font-medium text-primary hover:underline"
                    >
                      {department.name}
                    </Link>
                    <code className="block text-xs text-muted-foreground">
                      {department.code}
                    </code>
                  </TableCell>
                  <TableCell>
                    <Badge variant={department.is_production ? "info" : "outline"}>
                      {department.is_production ? "Production" : "Support"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={department.is_active ? "success" : "neutral"}>
                      {department.is_active ? "Active" : "Inactive"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {formatDate(department.created_at)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="sm" asChild>
                      <Link to={`/admin/departments/${department.id}`}>
                        {canManage ? "Manage" : "View"}
                      </Link>
                    </Button>
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

      <Can permission="departments.manage_departments">
        <CreateDepartmentDialog open={createOpen} onOpenChange={setCreateOpen} />
      </Can>
    </div>
  )
}
