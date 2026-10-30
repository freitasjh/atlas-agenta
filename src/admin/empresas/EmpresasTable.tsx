import * as React from "react";

import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { TenantListItem } from "@/types/domain";

import { EmpresaCard, EmpresaRow } from "./EmpresaRow";

interface EmpresasTableProps {
  tenants: TenantListItem[];
  /**
   * Slot da ação por empresa (ex.: "Mudar status" — ADR-07). Repassado a cada
   * linha/card. A ADR-06 não passa nada; a coluna/rodapé de ação não aparece.
   */
  renderAction?: (tenant: TenantListItem) => React.ReactNode;
}

/**
 * Lista de empresas em dois layouts que alternam por breakpoint: tabela
 * (`Table` shadcn) ≥md e cards <md (sem scroll horizontal no mobile). Cada `<th>`
 * tem rótulo pt-BR; a troca card↔tabela é só CSS (`md:`).
 */
export function EmpresasTable({ tenants, renderAction }: EmpresasTableProps) {
  const hasAction = Boolean(renderAction);
  return (
    <>
      {/* Desktop: tabela */}
      <div className="hidden rounded-lg border border-border md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Empresa</TableHead>
              <TableHead>Plano</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Fim do trial</TableHead>
              {hasAction ? (
                <TableHead className="text-right">Ações</TableHead>
              ) : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {tenants.map((tenant) => (
              <EmpresaRow
                key={tenant.id}
                tenant={tenant}
                renderAction={renderAction}
              />
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Mobile: cards */}
      <ul className="space-y-3 md:hidden">
        {tenants.map((tenant) => (
          <EmpresaCard
            key={tenant.id}
            tenant={tenant}
            renderAction={renderAction}
          />
        ))}
      </ul>
    </>
  );
}
