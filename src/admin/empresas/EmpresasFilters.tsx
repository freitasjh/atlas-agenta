import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getSubscriptionStatusLabel } from "@/components/StatusBadge";
import { SUBSCRIPTION_STATUSES, type SubscriptionStatus } from "@/types/domain";

/** Valor do filtro de status: um dos 5 status ou "todos" (sem filtro). */
export type StatusFilter = SubscriptionStatus | "todos";

interface EmpresasFiltersProps {
  search: string;
  onSearchChange: (value: string) => void;
  status: StatusFilter;
  onStatusChange: (value: StatusFilter) => void;
}

/**
 * Filtros da lista de empresas: busca por nome (controlada, debounce aplicado no
 * pai) e filtro por status de assinatura. Ambos operam client-side sobre o
 * resultado único da query — não disparam novas requisições. Mobile-first:
 * empilhados e full-width no mobile, lado a lado ≥sm. Cada controle tem `<label>`
 * associado (a11y).
 */
export function EmpresasFilters({
  search,
  onSearchChange,
  status,
  onStatusChange,
}: EmpresasFiltersProps) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <div className="w-full sm:max-w-sm">
        <label htmlFor="busca-empresas" className="sr-only">
          Buscar por nome
        </label>
        <Input
          id="busca-empresas"
          type="search"
          inputMode="search"
          placeholder="Buscar por nome"
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
        />
      </div>
      <div className="w-full sm:w-56">
        <label htmlFor="filtro-status-empresas" className="sr-only">
          Filtrar por status
        </label>
        <Select
          value={status}
          onValueChange={(value) => onStatusChange(value as StatusFilter)}
        >
          <SelectTrigger id="filtro-status-empresas">
            <SelectValue placeholder="Filtrar por status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos</SelectItem>
            {SUBSCRIPTION_STATUSES.map((value) => (
              <SelectItem key={value} value={value}>
                {getSubscriptionStatusLabel(value)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
