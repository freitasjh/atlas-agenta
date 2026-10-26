import { Link } from "react-router-dom";
import { Coins, type LucideIcon } from "lucide-react";

import { PageHeader } from "@/components/PageHeader";
import { StatePanel } from "@/components/StatePanel";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { usePermissions } from "@/hooks/usePermissions";
import { useSegmentFeatures } from "@/hooks/useSegmentFeatures";
import { cn } from "@/lib/utils";

interface ReportShortcut {
  to: string;
  titulo: string;
  descricao: string;
  icon: LucideIcon;
  /** Só aparece quando `true`. */
  visible: boolean;
}

/**
 * Hub de relatórios (`/app/relatorios`, ADR-08). Ponto de extensão para
 * relatórios futuros; hoje um card só ("Comissões"), gated por barbearia +
 * `canViewCommission`. Fora de barbearia (ou sem acesso), estado vazio honesto,
 * sem vazar a existência do recurso.
 *
 * Mesmo padrão visual do `ConfigHubPage` (cards-atalho). Os três guards do
 * layout já cuidam de auth/papel/assinatura; esta página só decide o que mostrar
 * por segmento/RBAC — a trava real de dados é o RLS.
 */
export function RelatoriosHubPage() {
  const { canViewCommission } = usePermissions();
  const { commission } = useSegmentFeatures();

  const shortcuts: ReportShortcut[] = [
    {
      to: "/app/relatorios/comissoes",
      titulo: "Comissões",
      descricao: "Quanto cada barbeiro recebeu de comissão por período.",
      icon: Coins,
      visible: commission && canViewCommission,
    },
  ];

  const visibleShortcuts = shortcuts.filter((shortcut) => shortcut.visible);

  return (
    <div className="space-y-6">
      <PageHeader
        titulo="Relatórios"
        descricao="Os números que ajudam a entender a sua operação."
      />

      {visibleShortcuts.length === 0 ? (
        <StatePanel
          titulo="Nenhum relatório disponível ainda"
          descricao="Não há relatórios disponíveis para o seu ramo por enquanto."
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {visibleShortcuts.map(({ to, titulo, descricao, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              className={cn(
                "group rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
              )}
            >
              <Card className="h-full transition-colors group-hover:border-primary/50">
                <CardHeader>
                  <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-md bg-primary/10 text-primary">
                    <Icon className="h-5 w-5" aria-hidden="true" />
                  </div>
                  <CardTitle>{titulo}</CardTitle>
                  <CardDescription>{descricao}</CardDescription>
                </CardHeader>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
