import * as React from "react";

import { ConnectionCard } from "@/app/config/whatsapp/ConnectionCard";
import { RecentMessagesList } from "@/app/config/whatsapp/RecentMessagesList";
import { PageHeader } from "@/components/PageHeader";
import { WhatsAppStatusBadge } from "@/components/WhatsAppStatusBadge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { usePermissions } from "@/hooks/usePermissions";
import { useWhatsAppInstance } from "@/hooks/useWhatsAppInstance";
import { getWhatsAppConnectionStatusLabel } from "@/lib/whatsapp";
import type { WhatsAppConnectionStatus } from "@/types/domain";

/** Painel de estado (erro) desta tela, no mesmo molde das demais telas. */
function StatePanel({
  titulo,
  descricao,
  children,
}: {
  titulo: string;
  descricao: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-2xl rounded-lg border border-dashed border-border p-8 text-center">
      <h2 className="font-display text-lg font-semibold tracking-tight">
        {titulo}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">{descricao}</p>
      {children ? (
        <div className="mt-4 flex justify-center">{children}</div>
      ) : null}
    </div>
  );
}

/**
 * Tela de conexão de WhatsApp (`/app/config/whatsapp`). Encena a máquina de
 * estados de `whatsapp_instances` (ADR-02): o admin pareia o número por QR
 * (mock) e qualquer papel do tenant vê o estado evoluir + o histórico recente.
 *
 * Herda os guards de rota existentes (`RequireAuth → RequireActiveSubscription →
 * AppLayout`); o gate é por **capacidade** (`canManageWhatsAppConnection`) no
 * botão, não por rota. O polling condicional de `useWhatsAppInstance` torna a
 * transição `aguardando_qr → conectado` observável sem reload. Uma região
 * `aria-live="polite"` anuncia a mudança de status aos leitores de tela.
 */
export function WhatsAppPage() {
  const { canManageWhatsAppConnection } = usePermissions();
  const instanceQuery = useWhatsAppInstance();

  const status: WhatsAppConnectionStatus =
    instanceQuery.data?.connection_status ?? "desconectado";

  return (
    <div className="space-y-6">
      <PageHeader
        titulo="WhatsApp"
        descricao="Conecte o número que fala com seus clientes."
        acoes={
          instanceQuery.isSuccess ? (
            <WhatsAppStatusBadge connectionStatus={status} />
          ) : undefined
        }
      />

      {/* Região viva: anuncia a transição da conexão sem interromper o leitor. */}
      <p className="sr-only" role="status" aria-live="polite">
        {instanceQuery.isSuccess
          ? `Status da conexão: ${getWhatsAppConnectionStatusLabel(status)}`
          : ""}
      </p>

      {instanceQuery.isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : instanceQuery.isError ? (
        <StatePanel
          titulo="Não foi possível carregar a conexão"
          descricao="Verifique sua conexão e tente novamente."
        >
          <Button
            variant="outline"
            onClick={() => void instanceQuery.refetch()}
          >
            Tentar novamente
          </Button>
        </StatePanel>
      ) : (
        <ConnectionCard
          instance={instanceQuery.data ?? null}
          canManage={canManageWhatsAppConnection}
        />
      )}

      <section className="space-y-3">
        <h2 className="font-display text-lg font-semibold tracking-tight">
          Mensagens recentes
        </h2>
        <RecentMessagesList />
      </section>
    </div>
  );
}
