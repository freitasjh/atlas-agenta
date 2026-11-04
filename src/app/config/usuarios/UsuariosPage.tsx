import { useState } from "react";

import { PageHeader } from "@/components/PageHeader";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { AtivosTab } from "@/app/config/usuarios/AtivosTab";
import { ConvitesTab } from "@/app/config/usuarios/ConvitesTab";

export function UsuariosPage() {
  const [tab, setTab] = useState<"ativos" | "convites">("ativos");

  return (
    <div className="space-y-6">
      <PageHeader
        titulo="Usuários"
        descricao="Gerencie os membros ativos da empresa e os convites pendentes."
      />

      <Tabs value={tab} onValueChange={(v) => setTab(v as "ativos" | "convites")}>
        <TabsList aria-label="Seções de usuários">
          <TabsTrigger value="ativos">Ativos</TabsTrigger>
          <TabsTrigger value="convites">Convites</TabsTrigger>
        </TabsList>
        <TabsContent value="ativos">
          <AtivosTab />
        </TabsContent>
        <TabsContent value="convites">
          <ConvitesTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
