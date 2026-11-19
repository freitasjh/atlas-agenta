import * as React from "react";

import { ConnectionCard } from "@/app/config/whatsapp/ConnectionCard";
import { RecentMessagesList } from "@/app/config/whatsapp/RecentMessagesList";
import { WhatsAppMetricsTab } from "@/app/config/whatsapp/WhatsAppMetricsTab";
import { whatsappMetricasMessages } from "@/app/config/whatsapp/whatsapp-metricas-messages";
import { PageHeader } from "@/components/PageHeader";
import { StatePanel } from "@/components/StatePanel";
import { WhatsAppStatusBadge } from "@/components/WhatsAppStatusBadge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { usePermissions } from "@/hooks/usePermissions";
import { useWhatsAppInstance } from "@/hooks/useWhatsAppInstance";
import { getWhatsAppConnectionStatusLabel } from "@/lib/whatsapp";
import type { WhatsAppConnectionStatus } from "@/types/domain";

const t = whatsappMetricasMessages;

/** Painel de estado (erro) desta tela, no mesmo molde das demais telas. */
function StatePanelLocal({
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
 * Tela de WhatsApp (`/app/config/whatsapp`, ADR-18 H, RF-39..RF-41).
 *
 * Tabs Conexão/Mensagens/Métricas (UX-SPEC H): a conexão encena a máquina de
 * estados de `whatsapp_instances`; mensagens lista o histórico recente;
 * métricas exibe KPIs + log filtrável — **só admin**. Recepção/profissional
 * veem as duas primeiras abas e encontram a negação explícita na terceira
 * (a trava real é o RLS; aqui, defesa em profundidade).
 *
 * O gate de pareamento continua por **capacidade**
 * (`canManageWhatsAppConnection`) no botão, não por rota. O polling
 * condicional de `useWhatsAppInstance` torna a transição
 * `aguardando_qr → conectado` observável sem reload. Uma região
 * `aria-live="polite"` anuncia a mudança de status aos leitores de tela.
 */
export function WhatsAppPage() {
  const { canManageWhatsAppConnection, isAdmin } = usePermissions();
  const instanceQuery = useWhatsAppInstance();
  const [tab, setTab] = React.useState("conexao");

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

      <Tabs value={tab} onValueChange={setTab} className="w-full">
        <TabsList aria-label={t.tabs.label} className="w-full">
          <TabsTrigger
            value="conexao"
            className="flex-1"
            onClick={() => setTab("conexao")}
          >
            {t.tabs.conexao}
          </TabsTrigger>
          <TabsTrigger
            value="mensagens"
            className="flex-1"
            onClick={() => setTab("mensagens")}
          >
            {t.tabs.mensagens}
          </TabsTrigger>
          <TabsTrigger
            value="metricas"
            className="flex-1"
            onClick={() => setTab("metricas")}
          >
            {t.tabs.metricas}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="conexao">
          {instanceQuery.isLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : instanceQuery.isError ? (
            <StatePanelLocal
              titulo="Não foi possível carregar a conexão"
              descricao="Verifique sua conexão e tente novamente."
            >
              <Button
                variant="outline"
                onClick={() => void instanceQuery.refetch()}
              >
                Tentar novamente
              </Button>
            </StatePanelLocal>
          ) : (
            <ConnectionCard
              instance={instanceQuery.data ?? null}
              canManage={canManageWhatsAppConnection}
            />
          )}
        </TabsContent>

        <TabsContent value="mensagens">
          <section className="space-y-3" aria-label={t.tabs.mensagens}>
            <h2 className="font-display text-lg font-semibold tracking-tight">
              Mensagens recentes
            </h2>
            <RecentMessagesList />
          </section>
        </TabsContent>

        <TabsContent value="metricas">
          {isAdmin ? (
            <WhatsAppMetricsTab />
          ) : (
            <StatePanel
              titulo={t.denied.title}
              descricao={t.denied.description}
            />
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
