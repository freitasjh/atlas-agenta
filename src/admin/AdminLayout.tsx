import { AdminSidebar } from "@/components/AdminSidebar";
import { DashboardShell } from "@/components/DashboardShell";

/**
 * Layout do painel do super admin (`/admin`). Mesma casca responsiva do
 * painel do tenant, com a navegação de administração.
 */
export function AdminLayout() {
  return (
    <DashboardShell
      areaLabel="a administração"
      sidebar={({ onNavigate }) => <AdminSidebar onNavigate={onNavigate} />}
    />
  );
}
