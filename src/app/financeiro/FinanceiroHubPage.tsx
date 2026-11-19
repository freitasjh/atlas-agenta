import { Link } from "react-router-dom";
import {
  ArrowDownUp,
  FileText,
  HandCoins,
  Landmark,
  Repeat2,
  TableProperties,
  Wallet,
  type LucideIcon,
} from "lucide-react";

import { EntitlementGate } from "@/components/EntitlementGate";
import { PageHeader } from "@/components/PageHeader";
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { usePlanEntitlements } from "@/hooks/usePlanEntitlements";

interface Capacidade {
  titulo: string;
  descricao: string;
  icon: LucideIcon;
  /** Chave do contrato que libera a capacidade; `null` = sem gating (SSoT operacional). */
  chave: keyof NonNullable<ReturnType<typeof usePlanEntitlements>> | null;
  /** Rota filha de `/app/financeiro` quando a capacidade já tem tela (ADR-03+). */
  rota?: string;
}

/**
 * Hub do Financeiro (`/app/financeiro`, Fase 5 ADR-01). Skeleton gated:
 * lista as 7 capacidades sem nenhuma tabela e sem nenhum request a tabelas
 * fase-5 ( fiscal/recebíveis ficam para ADR-02+). Cada capacidade com chave
 * usa `EntitlementGate` (conteúdo legível, escrita bloqueada + upsell);
 * `null` degrada para o upsell do próprio gate. Admin-only + segmento
 * `payments` vêm da rota e da sidebar; a trava real de dados é o RLS.
 */
const CAPACIDADES: readonly Capacidade[] = [
  {
    titulo: "Notas fiscais",
    descricao: "Emitir NFC-e dos atendimentos e vendas, com DANFE e XML.",
    icon: FileText,
    chave: "nfce",
    rota: "nfce",
  },
  {
    titulo: "Assinaturas",
    descricao: "Planos recorrentes, inadimplência e régua de cobrança.",
    icon: Repeat2,
    chave: "recorrencia",
    rota: "assinaturas",
  },
  {
    titulo: "Contas a pagar",
    descricao: "Fornecedores, vencimentos e baixas parciais.",
    icon: HandCoins,
    chave: "contasPagar",
    rota: "pagar",
  },
  {
    titulo: "Contas a receber",
    descricao: "Cobranças avulsas PIX e acompanhamento do recebido.",
    icon: Wallet,
    chave: null,
    rota: "receber",
  },
  {
    titulo: "Conciliação",
    descricao: "Conferir o extrato com os lançamentos, sem divergência.",
    icon: ArrowDownUp,
    chave: "conciliacao",
    rota: "conciliacao",
  },
  {
    titulo: "DRE e fluxo de caixa",
    descricao: "Resultado por competência e saldo projetado de 30 dias.",
    icon: TableProperties,
    chave: "dreFluxo",
    rota: "dre",
  },
  {
    titulo: "Exportar para o contador",
    descricao: "Período, formato e escopo com registro de exportação.",
    icon: Landmark,
    chave: "exportContabil",
    rota: "exportar",
  },
];

export function FinanceiroHubPage() {
  const entitlements = usePlanEntitlements();

  return (
    <div className="space-y-6">
      <PageHeader
        titulo="Financeiro"
        descricao="Notas fiscais, assinaturas, contas, conciliação e DRE em um só lugar."
      />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {CAPACIDADES.map(({ titulo, descricao, icon: Icon, chave, rota }) => {
          const card = (
            <Card
              className="h-full"
              role="group"
              aria-label={`${titulo}: ${descricao}`}
            >
              <CardHeader>
                <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-md bg-primary/10 text-primary">
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </div>
                <CardTitle>{titulo}</CardTitle>
                <CardDescription>{descricao}</CardDescription>
              </CardHeader>
              <CardFooter>
                {rota ? (
                  <Link
                    to={rota}
                    className="text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    Abrir {titulo.toLowerCase()}
                  </Link>
                ) : (
                  <p className="text-sm text-muted-foreground">Em breve</p>
                )}
              </CardFooter>
            </Card>
          );
          if (chave === null) return <div key={titulo}>{card}</div>;
          return (
            <EntitlementGate
              key={titulo}
              entitled={entitlements?.[chave] ?? null}
              recurso={titulo}
              acaoLabel={`Usar ${titulo.toLowerCase()}`}
            >
              {card}
            </EntitlementGate>
          );
        })}
      </div>
      <p className="text-sm text-muted-foreground">
        Quer liberar uma capacidade?{" "}
        <Link
          to="/precos"
          className="underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Ver planos
        </Link>
      </p>
    </div>
  );
}
