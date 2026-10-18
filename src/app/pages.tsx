import { BillingGateLayout } from "@/app/BillingGateLayout";
import { PageHeader } from "@/components/PageHeader";
import { PlaceholderPanel } from "@/components/PlaceholderPanel";
import { SignOutButton } from "@/components/SignOutButton";
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

/**
 * Tela de quitação (`/app/quitacao`), destino do redirect de tenant
 * `bloqueado` em `RequireActiveSubscription`. Fica FORA do guard de assinatura
 * (irmã do bloco `/app`) para o redirect não entrar em loop.
 *
 * CTA é um placeholder honesto: o fluxo real de regularização (cobrança PIX via
 * Asaas) é de uma fase financeira posterior e NÃO é implementado aqui — nada de
 * `charges`/Asaas nesta fase. O botão "Sair" usa `useSignOut` (via
 * `SignOutButton`) e dá ao usuário bloqueado uma saída real.
 */
export function QuitacaoPage() {
  return (
    <BillingGateLayout>
      <div className="space-y-6 text-center">
        <div className="flex justify-center">
          <StatusBadge subscriptionStatus="bloqueado" />
        </div>
        <div className="space-y-2">
          <h1 className="font-display text-2xl font-semibold tracking-tight">
            Sua assinatura está bloqueada
          </h1>
          <p className="text-sm text-muted-foreground">
            O acesso aos módulos está suspenso até a regularização do pagamento.
            Assim que a pendência for quitada, sua operação volta ao normal.
          </p>
        </div>
        <div className="space-y-3">
          {/*
            Placeholder: o botão "Regularizar pagamento" real liga no módulo de
            cobrança (PIX/Asaas) da fase financeira seguinte. Aqui orientamos o
            contato, sem fingir um fluxo que ainda não existe.
          */}
          <p className="text-sm text-muted-foreground">
            Para regularizar, fale com o nosso time de suporte.
          </p>
          <SignOutButton variant="outline" className="w-full" />
        </div>
      </div>
    </BillingGateLayout>
  );
}

/**
 * Estado terminal "Conta cancelada" (destino de `cancelado` em
 * `RequireActiveSubscription`). Mesmo layout enxuto da quitação, copy terminal e
 * SEM CTA de pagamento — cancelado ≠ débito a quitar. Só orientação de
 * reativação/contato e a ação de sair.
 */
export function ContaCanceladaPage() {
  return (
    <BillingGateLayout>
      <div className="space-y-6 text-center">
        <div className="flex justify-center">
          <StatusBadge subscriptionStatus="cancelado" />
        </div>
        <div className="space-y-2">
          <h1 className="font-display text-2xl font-semibold tracking-tight">
            Esta conta foi cancelada
          </h1>
          <p className="text-sm text-muted-foreground">
            O acesso às operações está suspenso. Para reativar a conta, fale com
            o nosso time.
          </p>
        </div>
        <SignOutButton variant="outline" className="w-full" />
      </div>
    </BillingGateLayout>
  );
}


