import { useMemo, useState } from "react";

import { CobrancaDialog } from "@/app/financeiro/receber/CobrancaDialog";
import { NovaAvulsaDialog } from "@/app/financeiro/receber/NovaAvulsaDialog";
import { ReceberDialog } from "@/app/financeiro/receber/ReceberDialog";
import { PageHeader } from "@/components/PageHeader";
import { StatePanel } from "@/components/StatePanel";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AtendimentosTab } from "@/app/financeiro/receber/AtendimentosTab";
import { AvulsasTab } from "@/app/financeiro/receber/AvulsasTab";
import { useSegmentFeatures } from "@/hooks/useSegmentFeatures";
import type { Receivable } from "@/lib/receber";

/**
 * Contas a receber (`/app/financeiro/receber`, Fase 5 ADR-07).
 *
 * Admin-only pela rota (`RequireRole admin`) + RLS no banco. Sem entitlement
 * novo: o recurso usa a base `payments` do segmento (avulsas são extensão do
 * recebimento operacional). Segmento fora de `payments` → estado legível e
 * **zero request**.
 *
 * Duas abas que NUNCA se misturam:
 *  - Atendimentos: ledger `appointment_payments` somente leitura (SSoT receita),
 *    alimentado por `financial_summary` + `receivable_ledger_list`.
 *  - Avulsas: `receivables`/`receivable_settlements` com barra pago vs total,
 *    cobrança PIX/WhatsApp e registro de recebimento manual. Nada aqui entra no
 *    ledger.
 */
export function ReceberPage() {
  const { payments } = useSegmentFeatures();
  const liberado = payments === true;

  const [tab, setTab] = useState<"atendimentos" | "avulsas">("atendimentos");
  const [novaAberta, setNovaAberta] = useState(false);
  const [cobranca, setCobranca] = useState<Receivable | null>(null);
  const [receber, setReceber] = useState<Receivable | null>(null);

  const acoes = useMemo(
    () =>
      tab === "avulsas" ? (
        <Button type="button" className="min-h-11" onClick={() => setNovaAberta(true)}>
          Nova cobrança
        </Button>
      ) : null,
    [tab],
  );

  if (!liberado) {
    return (
      <div className="space-y-6">
        <PageHeader
          titulo="Contas a receber"
          descricao="Atendimentos e cobranças avulsas em um só lugar."
        />
        <StatePanel
          titulo={
            payments === null
              ? "Carregando contas a receber"
              : "Contas a receber disponíveis para salões e barbearias"
          }
          descricao={
            payments === null
              ? "Assim que o ramo da empresa carregar, o conteúdo aparece aqui."
              : "O recebimento operacional deste ramo não usa o fluxo de pagamentos. Nenhum dado financeiro foi consultado."
          }
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        titulo="Contas a receber"
        descricao="Atendimentos e cobranças avulsas em um só lugar."
        acoes={acoes}
      />

      <Tabs value={tab} onValueChange={(v) => setTab(v === "avulsas" ? "avulsas" : "atendimentos")}>
        <TabsList>
          <TabsTrigger value="atendimentos" className="min-h-11">
            Atendimentos
          </TabsTrigger>
          <TabsTrigger value="avulsas" className="min-h-11">
            Avulsas
          </TabsTrigger>
        </TabsList>
        <TabsContent value="atendimentos">
          <AtendimentosTab />
        </TabsContent>
        <TabsContent value="avulsas">
          <AvulsasTab onCobrar={setCobranca} onReceber={setReceber} onNova={() => setNovaAberta(true)} />
        </TabsContent>
      </Tabs>

      <NovaAvulsaDialog aberto={novaAberta} aoAlterarAberto={setNovaAberta} />
      <CobrancaDialog conta={cobranca} aoFechar={() => setCobranca(null)} />
      <ReceberDialog conta={receber} aoFechar={() => setReceber(null)} />
    </div>
  );
}
