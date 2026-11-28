import * as React from "react"
import { Link, Navigate, Route, Routes, useLocation } from "react-router-dom"

import { useAccess } from "@/app/access"
import { HomeRedirect, RequireAuth, RequirePermission } from "@/app/guards"
import { LoadingState, PermissionDeniedState } from "@/components/feedback/states"
import { AppShell } from "@/components/layout/app-shell"
import { Button } from "@/components/ui/button"

/**
 * Pages are code-split per route: the initial bundle only carries the shell,
 * auth screens and shared UI. Named exports are adapted to the default export
 * `React.lazy` expects.
 */
const lazyPage = <T extends object>(loader: () => Promise<T>, name: keyof T) =>
  React.lazy(() =>
    loader().then((module) => ({
      default: module[name] as React.ComponentType,
    })),
  )

const LoginPage = lazyPage(() => import("@/features/auth/pages/login-page"), "LoginPage")
const ForgotPasswordPage = lazyPage(
  () => import("@/features/auth/pages/password-pages"),
  "ForgotPasswordPage",
)
const ResetPasswordPage = lazyPage(
  () => import("@/features/auth/pages/password-pages"),
  "ResetPasswordPage",
)
const AcceptInvitationPage = lazyPage(
  () => import("@/features/auth/pages/password-pages"),
  "AcceptInvitationPage",
)
const VerifyEmailPage = lazyPage(
  () => import("@/features/auth/pages/password-pages"),
  "VerifyEmailPage",
)
const ProfilePage = lazyPage(() => import("@/features/auth/pages/profile-page"), "ProfilePage")
const ChangePasswordPage = lazyPage(
  () => import("@/features/auth/pages/change-password-page"),
  "ChangePasswordPage",
)
const DashboardPage = lazyPage(
  () => import("@/features/dashboard/pages/dashboard-page"),
  "DashboardPage",
)
const OrdersListPage = lazyPage(
  () => import("@/features/orders/pages/orders-list-page"),
  "OrdersListPage",
)
const OrderCreatePage = lazyPage(
  () => import("@/features/orders/pages/order-create-page"),
  "OrderCreatePage",
)
const OrderDetailsPage = lazyPage(
  () => import("@/features/orders/pages/order-details-page"),
  "OrderDetailsPage",
)
const MyWorkPage = lazyPage(
  () => import("@/features/production/pages/my-work-page"),
  "MyWorkPage",
)
const EmployeesListPage = lazyPage(
  () => import("@/features/employees/pages/employees-list-page"),
  "EmployeesListPage",
)
const EmployeeCreatePage = lazyPage(
  () => import("@/features/employees/pages/employee-create-page"),
  "EmployeeCreatePage",
)
const EmployeeDetailsPage = lazyPage(
  () => import("@/features/employees/pages/employee-details-page"),
  "EmployeeDetailsPage",
)
const TargetsListPage = lazyPage(
  () => import("@/features/targets/pages/targets-list-page"),
  "TargetsListPage",
)
const TargetDetailsPage = lazyPage(
  () => import("@/features/targets/pages/target-details-page"),
  "TargetDetailsPage",
)
const ReportsPage = lazyPage(
  () => import("@/features/reports/pages/reports-page"),
  "ReportsPage",
)
const RolesListPage = lazyPage(
  () => import("@/features/rbac/pages/roles-list-page"),
  "RolesListPage",
)
const RoleDetailsPage = lazyPage(
  () => import("@/features/rbac/pages/role-details-page"),
  "RoleDetailsPage",
)
const PermissionsPage = lazyPage(
  () => import("@/features/rbac/pages/permissions-page"),
  "PermissionsPage",
)
const DepartmentsListPage = lazyPage(
  () => import("@/features/rbac/pages/departments-list-page"),
  "DepartmentsListPage",
)
const DepartmentDetailsPage = lazyPage(
  () => import("@/features/rbac/pages/department-details-page"),
  "DepartmentDetailsPage",
)
const UserAccessPage = lazyPage(
  () => import("@/features/rbac/pages/user-access-page"),
  "UserAccessPage",
)
const InvitationsPage = lazyPage(
  () => import("@/features/invitations/pages/invitations-page"),
  "InvitationsPage",
)
const AuditLogsPage = lazyPage(
  () => import("@/features/audit/pages/audit-logs-page"),
  "AuditLogsPage",
)
const SystemSettingsPage = lazyPage(
  () => import("@/features/settings/pages/system-settings-page"),
  "SystemSettingsPage",
)
const EmailSettingsPage = lazyPage(
  () => import("@/features/settings/pages/email-settings-page"),
  "EmailSettingsPage",
)

function RouteFallback() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center">
      <LoadingState label="Loading…" />
    </div>
  )
}

function NotFoundPage() {
  const location = useLocation()
  return (
    <div className="mx-auto max-w-md space-y-3 py-16 text-center">
      <p className="text-sm font-semibold text-muted-foreground">404</p>
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <p className="text-sm text-muted-foreground">
        Nothing is routed at <code>{location.pathname}</code>.
      </p>
      <Button asChild variant="outline" size="sm">
        <Link to="/">Back to dashboard</Link>
      </Button>
    </div>
  )
}

/**
 * Landing route.
 *
 * The dashboard needs `reports.view_reports`; accounts without it are forwarded
 * to the first screen they can actually use instead of hitting a denial wall.
 */
function IndexRoute() {
  const { can } = useAccess()

  if (can("reports.view_reports")) return <DashboardPage />
  if (can("orders.view_order")) return <Navigate to="/orders" replace />
  if (can("production.update_status")) return <Navigate to="/production" replace />
  if (can("employees.view_employee")) return <Navigate to="/employees" replace />
  if (can("targets.view_targets")) return <Navigate to="/targets" replace />

  return (
    <HomeRedirect>
      <PermissionDeniedState />
    </HomeRedirect>
  )
}

export function AppRouter() {
  return (
    <React.Suspense fallback={<RouteFallback />}>
      <Routes>
        {/* Public routes ---------------------------------------------------- */}
        <Route path="/login" element={<LoginPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/accept-invitation" element={<AcceptInvitationPage />} />
        <Route path="/verify-email" element={<VerifyEmailPage />} />

        {/* Authenticated application --------------------------------------- */}
        <Route
          element={
            <RequireAuth>
              <AppShell />
            </RequireAuth>
          }
        >
          <Route index element={<IndexRoute />} />

          <Route
            path="orders"
            element={
              <RequirePermission permission={["orders.view_order"]}>
                <OrdersListPage />
              </RequirePermission>
            }
          />
          <Route
            path="orders/new"
            element={
              <RequirePermission permission={["orders.create_order"]}>
                <OrderCreatePage />
              </RequirePermission>
            }
          />
          <Route
            path="orders/:orderId"
            element={
              <RequirePermission permission={["orders.view_order"]}>
                <OrderDetailsPage />
              </RequirePermission>
            }
          />

          <Route
            path="production"
            element={
              <RequirePermission permission={["production.update_status"]}>
                <MyWorkPage />
              </RequirePermission>
            }
          />

          <Route
            path="employees"
            element={
              <RequirePermission permission={["employees.view_employee"]}>
                <EmployeesListPage />
              </RequirePermission>
            }
          />
          <Route
            path="employees/new"
            element={
              <RequirePermission permission={["employees.create_employee"]}>
                <EmployeeCreatePage />
              </RequirePermission>
            }
          />
          <Route
            path="employees/:employeeId"
            element={
              <RequirePermission permission={["employees.view_employee"]}>
                <EmployeeDetailsPage />
              </RequirePermission>
            }
          />

          <Route
            path="targets"
            element={
              <RequirePermission permission={["targets.view_targets"]}>
                <TargetsListPage />
              </RequirePermission>
            }
          />
          <Route
            path="targets/:targetId"
            element={
              <RequirePermission permission={["targets.view_targets"]}>
                <TargetDetailsPage />
              </RequirePermission>
            }
          />

          <Route
            path="reports"
            element={
              <RequirePermission permission={["reports.view_reports"]}>
                <ReportsPage />
              </RequirePermission>
            }
          />

          <Route path="profile" element={<ProfilePage />} />
          <Route path="change-password" element={<ChangePasswordPage />} />

          {/* Administration ------------------------------------------------- */}
          <Route
            path="admin/roles"
            element={
              <RequirePermission permission={["roles.view_roles"]}>
                <RolesListPage />
              </RequirePermission>
            }
          />
          <Route
            path="admin/roles/:roleId"
            element={
              <RequirePermission permission={["roles.view_roles"]}>
                <RoleDetailsPage />
              </RequirePermission>
            }
          />
          <Route
            path="admin/permissions"
            element={
              <RequirePermission permission={["permissions.view_permissions"]}>
                <PermissionsPage />
              </RequirePermission>
            }
          />
          <Route
            path="admin/departments"
            element={
              <RequirePermission permission={["departments.view_departments"]}>
                <DepartmentsListPage />
              </RequirePermission>
            }
          />
          <Route
            path="admin/departments/:departmentId"
            element={
              <RequirePermission permission={["departments.view_departments"]}>
                <DepartmentDetailsPage />
              </RequirePermission>
            }
          />
          <Route
            path="admin/users/:userId"
            element={
              <RequirePermission
                permission={["users.manage_users", "scopes.manage_user_restrictions"]}
              >
                <UserAccessPage />
              </RequirePermission>
            }
          />
          <Route
            path="admin/invitations"
            element={
              <RequirePermission permission={["invitations.view_invitation"]}>
                <InvitationsPage />
              </RequirePermission>
            }
          />
          <Route
            path="admin/audit"
            element={
              <RequirePermission permission={["audit_logs.view_logs"]}>
                <AuditLogsPage />
              </RequirePermission>
            }
          />

          {/* System --------------------------------------------------------- */}
          <Route
            path="system/settings"
            element={
              <RequirePermission permission={["system.manage_settings"]}>
                <SystemSettingsPage />
              </RequirePermission>
            }
          />
          <Route
            path="system/email"
            element={
              <RequirePermission permission={["system.manage_email_config"]}>
                <EmailSettingsPage />
              </RequirePermission>
            }
          />

          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </React.Suspense>
  )
}
