import { PageHeader } from "@/components/PageHeader";
import { PlaceholderPanel } from "@/components/PlaceholderPanel";
import { StatusBadge } from "@/components/StatusBadge";
import { APPOINTMENT_STATUSES } from "@/types/domain";

/**
 * Páginas-casca do painel do tenant (`/app`). Mínimas e em pt-BR; o conteúdo
 * real das telas vem nas fases seguintes. Rendem dentro do AppLayout.
 */

export function DashboardPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        titulo="Visão geral"
        descricao="Resumo da operação do dia. Painel em construção."
      />
      <PlaceholderPanel
        titulo="Painel do tenant"
        descricao="Indicadores de agenda e cobrança aparecem aqui nas próximas fases."
      />
    </div>
  );
}

export function AgendaPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        titulo="Agenda"
        descricao="Agendamentos por dia, semana e profissional. Em construção."
      />
      <PlaceholderPanel
        titulo="Agenda do tenant"
        descricao="A grade de horários e a criação de agendamentos vêm nas próximas fases. Abaixo, os estados do agendamento:"
      >
        <div className="flex flex-wrap gap-2">
          {APPOINTMENT_STATUSES.map((status) => (
            <StatusBadge key={status} status={status} />
          ))}
        </div>
      </PlaceholderPanel>
    </div>
  );
}

export function ClientesPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        titulo="Clientes"
        descricao="Cadastro de clientes e consentimento de WhatsApp. Em construção."
      />
      <PlaceholderPanel
        titulo="Clientes do tenant"
        descricao="O cadastro de clientes e o opt-in de WhatsApp vêm nas próximas fases."
      />
    </div>
  );
}

export function CobrancasPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        titulo="Cobranças"
        descricao="Cobranças PIX pós-atendimento e baixa automática. Em construção."
      />
      <PlaceholderPanel
        titulo="Cobranças do tenant"
        descricao="A lista de cobranças PIX e o status de pagamento vêm nas próximas fases."
      />
    </div>
  );
}

export function ConfigPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        titulo="Configurações"
        descricao="Serviços, equipe, horários e WhatsApp. Em construção."
      />
      <PlaceholderPanel
        titulo="Configurações do tenant"
        descricao="A configuração de serviços, equipe e integração de WhatsApp vêm nas próximas fases."
      />
    </div>
  );
}
