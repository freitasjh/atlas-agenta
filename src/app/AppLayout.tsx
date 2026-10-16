import { AppSidebar } from "@/components/AppSidebar";
import { DashboardShell } from "@/components/DashboardShell";

/**
 * Layout do painel do tenant (`/app`). A casca responsiva (sidebar fixa em
 * ≥768px, Sheet no mobile) vem do `DashboardShell`.
 */
export function AppLayout() {
  return (
    <DashboardShell
      areaLabel="o painel"
      sidebar={({ onNavigate }) => <AppSidebar onNavigate={onNavigate} />}
    />
  );
}
