import { PageHeader } from "@/components/PageHeader";
import { PlaceholderPanel } from "@/components/PlaceholderPanel";

/**
 * Páginas-casca do painel do super admin (`/admin`). Mínimas e em pt-BR;
 * rendem dentro do AdminLayout.
 *
 * `EmpresasPage` deixou de ser placeholder: foi extraída para
 * `src/admin/empresas/EmpresasPage.tsx` (lista cross-tenant + filtros) e é
 * **reexportada** aqui para o router manter `import { EmpresasPage } from
 * "@/admin/pages"` estável. `AdminDashboardPage` segue placeholder (fora de
 * escopo desta fatia).
 */

export { EmpresasPage } from "./empresas/EmpresasPage";

export function AdminDashboardPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        titulo="Painel do super admin"
        descricao="Gestão da plataforma Atlas Agenda. Em construção."
      />
      <PlaceholderPanel
        titulo="Visão da plataforma"
        descricao="Indicadores de empresas, assinaturas e uso aparecem aqui nas próximas fases."
      />
    </div>
  );
}
