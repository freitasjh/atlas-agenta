import { useEffect, useMemo, useState } from "react";

import { PageHeader } from "@/components/PageHeader";
import { StatePanel } from "@/components/StatePanel";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { getSubscriptionStatusLabel } from "@/components/StatusBadge";
import { useAdminTenants } from "@/hooks/useAdminTenants";
import { SUBSCRIPTION_STATUSES, type TenantListItem } from "@/types/domain";

import {
  EmpresasFilters,
  type StatusFilter,
} from "./EmpresasFilters";
import { EmpresasTable } from "./EmpresasTable";
import { MudarStatusDialog } from "./MudarStatusDialog";

/** Valor com debounce leve para a busca client-side (não refaz request). */
function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

/** Remove acentos e caixa para a busca ser tolerante a digitação. */
function normalizeForSearch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/**
 * Resumo de contagem por status ("12 ativas · 3 em trial · 2 bloqueadas"),
 * derivado em memória das linhas carregadas — não é painel de métricas. Só
 * entram os status com ao menos uma empresa; o rótulo pt-BR vem da fonte única
 * do `StatusBadge`.
 */
function buildSignature(tenants: TenantListItem[]): string {
  const counts = new Map<string, number>();
  for (const tenant of tenants) {
    counts.set(
      tenant.subscription_status,
      (counts.get(tenant.subscription_status) ?? 0) + 1,
    );
  }
  const parts = SUBSCRIPTION_STATUSES.filter(
    (status) => (counts.get(status) ?? 0) > 0,
  ).map(
    (status) =>
      `${counts.get(status)} ${getSubscriptionStatusLabel(status).toLowerCase()}`,
  );
  return parts.join(" · ");
}

/**
 * Tela de Empresas do painel do super admin (`/admin/empresas`). Lista todas as
 * empresas assinantes cross-tenant (a trava é o RLS `tenants_super_admin`; o
 * guard de rota já barra quem não é `super_admin`), com busca por nome, filtro
 * por status e resumo de contagem. Busca e filtro são estado de UI client-side
 * sobre o resultado único da query (`useAdminTenants`) — combinam por AND e não
 * disparam novas requisições (volume baixo no MVP). Estados loading/vazio(2
 * variantes)/erro em pt-BR. Cada linha expõe a ação "Mudar status"
 * (`MudarStatusDialog`), que opera a assinatura por um canal auditado.
 */
export function EmpresasPage() {
  const tenantsQuery = useAdminTenants();

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("todos");
  const debouncedSearch = useDebouncedValue(search, 250);

  const tenants = useMemo(
    () => tenantsQuery.data ?? [],
    [tenantsQuery.data],
  );

  const filteredTenants = useMemo(() => {
    const term = normalizeForSearch(debouncedSearch.trim());
    return tenants.filter((tenant) => {
      const statusMatch =
        status === "todos" || tenant.subscription_status === status;
      if (!statusMatch) return false;
      if (term === "") return true;
      const tradeMatch =
        tenant.trade_name !== null &&
        normalizeForSearch(tenant.trade_name).includes(term);
      const legalMatch = normalizeForSearch(tenant.legal_name).includes(term);
      return tradeMatch || legalMatch;
    });
  }, [tenants, debouncedSearch, status]);

  const signature = useMemo(() => buildSignature(tenants), [tenants]);

  const hasTenants = tenants.length > 0;

  return (
    <div className="space-y-6">
      <PageHeader
        titulo="Empresas"
        descricao="Empresas assinantes da plataforma: plano, status de assinatura e fim do trial."
      />

      {tenantsQuery.isLoading ? (
        <div className="space-y-2" aria-busy="true">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : tenantsQuery.isError ? (
        <StatePanel
          titulo="Não foi possível carregar as empresas"
          descricao="Verifique a conexão e tente novamente."
        >
          <Button variant="outline" onClick={() => void tenantsQuery.refetch()}>
            Tentar novamente
          </Button>
        </StatePanel>
      ) : !hasTenants ? (
        <StatePanel
          titulo="Nenhuma empresa ainda"
          descricao="As empresas assinantes aparecem aqui assim que o primeiro cadastro for criado."
        />
      ) : (
        <>
          {signature ? (
            <p className="text-sm text-muted-foreground">{signature}</p>
          ) : null}

          <EmpresasFilters
            search={search}
            onSearchChange={setSearch}
            status={status}
            onStatusChange={setStatus}
          />

          {filteredTenants.length === 0 ? (
            <StatePanel
              titulo="Nenhuma empresa encontrada"
              descricao="Ajuste a busca ou o filtro de status para ver outras empresas."
            />
          ) : (
            <EmpresasTable
              tenants={filteredTenants}
              renderAction={(tenant) => <MudarStatusDialog tenant={tenant} />}
            />
          )}
        </>
      )}
    </div>
  );
}
