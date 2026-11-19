import { useState } from "react";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { crmMessages } from "@/app/clientes/crm-messages";
import { CustomerHistoricoTab } from "@/app/clientes/CustomerHistoricoTab";
import { CustomerMensagensTab } from "@/app/clientes/CustomerMensagensTab";
import { CustomerNotasTab } from "@/app/clientes/CustomerNotasTab";
import { CustomerPreferenciasTab } from "@/app/clientes/CustomerPreferenciasTab";
import { CustomerResumoTab } from "@/app/clientes/CustomerResumoTab";
import { FidelidadeTab } from "@/app/fidelidade/FidelidadeTab";
import type { Customer } from "@/types/domain";

const t = crmMessages.drawer;

type CrmTab = "resumo" | "historico" | "preferencias" | "notas" | "fidelidade" | "mensagens";

/**
 * Ficha 360° do cliente (ADR-16, RF-24..RF-30, UX-SPEC E).
 * Sheet lateral com 6 abas e lazy loading por aba (só monta o conteúdo da
 * aba ativa). Aba Fidelidade reusa `FidelidadeTab` (ADR-15) com gating próprio.
 */
export function CustomerDrawer({
  open,
  onOpenChange,
  customer,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customer: Customer | null;
}) {
  const [activeTab, setActiveTab] = useState<CrmTab>("resumo");

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col sm:max-w-md md:max-w-lg">
        <SheetHeader>
          <SheetTitle>{t.title}</SheetTitle>
          <SheetDescription>{customer?.name ?? ""}</SheetDescription>
        </SheetHeader>
        {customer ? (
          <div className="flex-1 overflow-y-auto py-4">
            <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as CrmTab)}>
              <TabsList className="grid w-full grid-cols-3 sm:grid-cols-6" aria-label={t.title}>
                <TabsTrigger value="resumo">{t.tabResumo}</TabsTrigger>
                <TabsTrigger value="historico">{t.tabHistorico}</TabsTrigger>
                <TabsTrigger value="preferencias">{t.tabPreferencias}</TabsTrigger>
                <TabsTrigger value="notas">{t.tabNotas}</TabsTrigger>
                <TabsTrigger value="fidelidade">{t.tabFidelidade}</TabsTrigger>
                <TabsTrigger value="mensagens">{t.tabMensagens}</TabsTrigger>
              </TabsList>
              <TabsContent value="resumo">
                {activeTab === "resumo" ? <CustomerResumoTab customer={customer} /> : null}
              </TabsContent>
              <TabsContent value="historico">
                {activeTab === "historico" ? <CustomerHistoricoTab customerId={customer.id} /> : null}
              </TabsContent>
              <TabsContent value="preferencias">
                {activeTab === "preferencias" ? <CustomerPreferenciasTab customerId={customer.id} /> : null}
              </TabsContent>
              <TabsContent value="notas">
                {activeTab === "notas" ? <CustomerNotasTab customerId={customer.id} /> : null}
              </TabsContent>
              <TabsContent value="fidelidade">
                {activeTab === "fidelidade" ? <FidelidadeTab customerId={customer.id} /> : null}
              </TabsContent>
              <TabsContent value="mensagens">
                {activeTab === "mensagens" ? <CustomerMensagensTab customerId={customer.id} /> : null}
              </TabsContent>
            </Tabs>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
