import { useEffect, useMemo, useState } from "react";

import { PageHeader } from "@/components/PageHeader";
import { StatePanel } from "@/components/StatePanel";
import { CommissionAmount } from "@/components/CommissionAmount";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { usePermissions } from "@/hooks/usePermissions";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useSegmentFeatures } from "@/hooks/useSegmentFeatures";
import { useProfessionals } from "@/hooks/useProfessionals";
import { useCommissionReport } from "@/hooks/useCommissionReport";
import { formatCentsToBRL } from "@/lib/money";

import { PeriodFilter, type PeriodPreset } from "@/app/relatorios/PeriodFilter";

/** `YYYY-MM-DD` de hoje no fuso do tenant. */
function todayIsoInTenantTz(timeZone: string): string {
  // en-CA já formata como YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/** Soma `days` a um `YYYY-MM-DD` por aritmética de calendário (sem fuso). */
function shiftIsoDate(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const base = new Date(Date.UTC(y, m - 1, d));
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

/** Primeiro e último dia (datas de calendário) do mês que contém `day`. */
function monthRangeIso(day: string): { first: string; last: string } {
  const [y, m] = day.split("-").map(Number);
  const first = `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-01`;
  // Dia 0 do mês seguinte = último dia do mês atual (sem fuso).
  const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  return { first, last };
}

/** Datas `[start, end]` (inclusivas) de um preset, ancoradas em `today`. */
function resolvePresetRange(
  preset: Exclude<PeriodPreset, "personalizado">,
  today: string,
): { start: string; end: string } {
  if (preset === "mes") {
    const { first, last } = monthRangeIso(today);
    return { start: first, end: last };
  }
  // mês passado: último dia do mês anterior → seu próprio mês.
  const prevMonthLast = shiftIsoDate(monthRangeIso(today).first, -1);
  const { first, last } = monthRangeIso(prevMonthLast);
  return { start: first, end: last };
}

/**
 * Relatório de comissão por período (`/app/relatorios/comissoes`, ADR-08).
 * Terceira e última superfície da Fase 1b: faixa-resumo (período + total geral)
 * + filtros (período via presets/data + profissional) + tabela desktop / cards
 * mobile, tudo via `CommissionAmount` para falar a mesma língua da agenda.
 *
 * Gating em camadas, sem flash e sem request indevido (CA-VIS-06): fora de
 * barbearia → "disponível apenas para barbearias"; receptionist → estado neutro;
 * o `useCommissionReport` só dispara quando segmento + RBAC permitem. Admin vê
 * todos (e pode filtrar um barbeiro); professional vê só a própria linha pelo
 * RLS. Os guards do layout já cobrem auth/papel/assinatura.
 */
export function ComissoesPage() {
  const { tenant } = useCurrentUser();
  const timeZone = tenant?.timezone ?? "America/Sao_Paulo";

  const { commission } = useSegmentFeatures();
  const { canViewCommission, canManageCommission } = usePermissions();

  // Só admin filtra por profissional; professional vê só a própria linha (RLS).
  const canFilterByProfessional = canManageCommission;
  const professionalsQuery = useProfessionals({
    activeOnly: false,
  });

  const [preset, setPreset] = useState<PeriodPreset>("mes");
  const today = todayIsoInTenantTz(timeZone);
  const initialRange = useMemo(
    () => resolvePresetRange("mes", today),
    [today],
  );
  const [start, setStart] = useState(initialRange.start);
  const [end, setEnd] = useState(initialRange.end);
  const [professionalId, setProfessionalId] = useState<string>("todos");

  // Ao trocar de preset fixo, deriva as bordas no fuso do tenant; no
  // personalizado, o usuário controla os dois inputs diretamente.
  useEffect(() => {
    if (preset === "personalizado") return;
    const range = resolvePresetRange(preset, today);
    setStart(range.start);
    setEnd(range.end);
  }, [preset, today]);

  const effectiveProfessionalId =
    canFilterByProfessional && professionalId !== "todos"
      ? professionalId
      : null;

  const reportQuery = useCommissionReport({
    startDate: start,
    endDate: end,
    professionalId: effectiveProfessionalId,
  });

  // Fora de barbearia: estado honesto, sem request (CA-VIS-06). O hook já não
  // dispara (enabled=false); aqui mostramos a mensagem de ramo.
  if (!commission) {
    return (
      <div className="space-y-6">
        <PageHeader
          titulo="Comissões"
          descricao="Comissão por profissional, por período."
        />
        <StatePanel
          titulo="Relatório de comissões"
          descricao="Este relatório está disponível apenas para barbearias."
        />
      </div>
    );
  }

  // Sem acesso (receptionist): estado neutro, nenhum valor exibido.
  if (!canViewCommission) {
    return (
      <div className="space-y-6">
        <PageHeader
          titulo="Comissões"
          descricao="Comissão por profissional, por período."
        />
        <StatePanel
          titulo="Acesso indisponível"
          descricao="Você não tem acesso a este relatório."
        />
      </div>
    );
  }

  const rows = reportQuery.data ?? [];
  const totalCents = rows.reduce(
    (sum, row) => sum + row.total_commission_cents,
    0,
  );
  const totalAppointments = rows.reduce(
    (sum, row) => sum + row.appointment_count,
    0,
  );

  const periodLabel = `${formatShortDate(start)} – ${formatShortDate(end)}`;

  return (
    <div className="space-y-6">
      <PageHeader
        titulo="Comissões"
        descricao="Quanto cada barbeiro recebeu de comissão no período."
      />

      {/* Faixa-resumo: período + total geral em destaque. */}
      <Card>
        <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">Período</p>
            <p className="font-medium tabular-nums">{periodLabel}</p>
          </div>
          <div className="space-y-1 sm:text-right">
            <p className="text-sm text-muted-foreground">Total de comissões</p>
            <p className="font-display text-2xl font-semibold tabular-nums">
              {reportQuery.isSuccess ? formatCentsToBRL(totalCents) : "—"}
            </p>
            {reportQuery.isSuccess ? (
              <p className="text-xs text-muted-foreground tabular-nums">
                {totalAppointments}{" "}
                {totalAppointments === 1
                  ? "atendimento"
                  : "atendimentos"}
              </p>
            ) : null}
          </div>
        </CardHeader>
      </Card>

      {/* Filtros: período + profissional (profissional só para admin). */}
      <div className="flex flex-col gap-4">
        <PeriodFilter
          preset={preset}
          start={start}
          end={end}
          onPresetChange={setPreset}
          onStartChange={setStart}
          onEndChange={setEnd}
        />

        {canFilterByProfessional ? (
          <div className="space-y-1 sm:max-w-xs">
            <Label htmlFor="relatorio-profissional">Profissional</Label>
            <Select
              value={professionalId}
              onValueChange={setProfessionalId}
            >
              <SelectTrigger
                id="relatorio-profissional"
                aria-label="Filtrar por profissional"
              >
                <SelectValue placeholder="Todos os profissionais" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos os profissionais</SelectItem>
                {(professionalsQuery.data ?? []).map((professional) => (
                  <SelectItem key={professional.id} value={professional.id}>
                    {professional.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
      </div>

      {/* Conteúdo: loading / erro / vazio / dados. */}
      {reportQuery.isLoading ? (
        <div className="space-y-2" aria-busy="true">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : reportQuery.isError ? (
        <StatePanel
          titulo="Não foi possível carregar o relatório"
          descricao="Verifique sua conexão e tente novamente."
        >
          <Button
            variant="outline"
            onClick={() => void reportQuery.refetch()}
          >
            Tentar novamente
          </Button>
        </StatePanel>
      ) : rows.length === 0 ? (
        <StatePanel
          titulo="Nenhuma comissão registrada neste período"
          descricao="Assim que houver atendimentos concluídos com comissão, eles aparecem aqui."
        />
      ) : (
        <>
          {/* Desktop: tabela. */}
          <div className="hidden sm:block">
            <div className="rounded-lg border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Profissional</TableHead>
                    <TableHead className="text-right">Atendimentos</TableHead>
                    <TableHead className="text-right">Comissão</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.professional_id}>
                      <TableCell className="font-medium">
                        {row.professional_name}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {row.appointment_count}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCentsToBRL(row.total_commission_cents)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter>
                  <TableRow>
                    <TableCell className="font-medium">Total</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {totalAppointments}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCentsToBRL(totalCents)}
                    </TableCell>
                  </TableRow>
                </TableFooter>
              </Table>
            </div>
          </div>

          {/* Mobile: cards (sem scroll horizontal). */}
          <ul className="space-y-3 sm:hidden">
            {rows.map((row) => (
              <li key={row.professional_id}>
                <Card>
                  <CardContent className="flex items-center justify-between gap-4 py-4">
                    <div className="min-w-0 space-y-1">
                      <p className="truncate font-medium">
                        {row.professional_name}
                      </p>
                      <p className="text-xs text-muted-foreground tabular-nums">
                        {row.appointment_count}{" "}
                        {row.appointment_count === 1
                          ? "atendimento"
                          : "atendimentos"}
                      </p>
                    </div>
                    <CommissionAmount
                      commissionCents={row.total_commission_cents}
                      className="shrink-0"
                    />
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/** `YYYY-MM-DD` → `dd/MM/yyyy` por aritmética de calendário (sem fuso). */
function formatShortDate(dateStr: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!match) return dateStr;
  const [, year, month, day] = match;
  return `${day}/${month}/${year}`;
}
