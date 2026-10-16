import { PageHeader } from "@/components/PageHeader";
import { PlaceholderPanel } from "@/components/PlaceholderPanel";

/**
 * Páginas-casca do painel do super admin (`/admin`). Mínimas e em pt-BR;
 * rendem dentro do AdminLayout.
 */

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

export function EmpresasPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        titulo="Empresas"
        descricao="Empresas assinantes, planos e instâncias de WhatsApp. Em construção."
      />
      <PlaceholderPanel
        titulo="Empresas assinantes"
        descricao="A lista de empresas, o status de assinatura e os limites de uso vêm nas próximas fases."
      />
    </div>
  );
}
