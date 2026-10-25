import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { formatDateInTenantTz, formatTimeInTenantTz } from "@/lib/datetime";
import type { AppointmentWithRelations } from "@/types/domain";

/**
 * Tabela de exceções D-1 (RF-DASH-08, AC-09): os agendamentos `pendente` do dia
 * local de amanhã, cada linha com um link real "Ver na agenda" para a agenda do
 * dia correspondente (`/app/agenda?dia=<amanhã>`). Em viewport estreita degrada
 * para **cartões empilhados** (sem scroll horizontal), o padrão já visto na
 * agenda. Vazio → mensagem positiva em pt-BR (a emptiness é alívio, não defeito).
 *
 * `<table>` semântica com `<caption>` e `<th scope>`; o link tem `aria-label`
 * incluindo cliente e horário. PII do cliente é só para a tela, nunca logada.
 */

interface PendingConfirmationTableProps {
  appointments: AppointmentWithRelations[];
  timeZone: string;
  /** `YYYY-MM-DD` do dia local de amanhã (destino do link para a agenda). */
  tomorrowIso: string;
}

export function PendingConfirmationTable({
  appointments,
  timeZone,
  tomorrowIso,
}: PendingConfirmationTableProps) {
  const agendaHref = `/app/agenda?dia=${tomorrowIso}`;

  if (appointments.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-8 text-center">
        <p className="text-sm text-muted-foreground">
          Nenhuma confirmação pendente para amanhã. Tudo em dia.
        </p>
      </div>
    );
  }

  function linkFor(appointment: AppointmentWithRelations) {
    const cliente = appointment.customers?.name ?? "cliente sem nome";
    const horario = formatTimeInTenantTz(appointment.starts_at, timeZone);
    return (
      <Link
        to={agendaHref}
        aria-label={`Ver na agenda o agendamento de ${cliente} às ${horario} de ${formatDateInTenantTz(
          appointment.starts_at,
          timeZone,
        )}`}
        className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
      >
        Ver na agenda
        <ArrowRight aria-hidden="true" />
      </Link>
    );
  }

  return (
    <>
      {/* Mobile: cartões empilhados (sem scroll horizontal). */}
      <ul className="space-y-3 sm:hidden">
        {appointments.map((appointment) => (
          <li
            key={appointment.id}
            className="rounded-lg border border-border bg-card p-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <p className="font-display text-sm font-semibold tabular-nums text-foreground">
                  {formatTimeInTenantTz(appointment.starts_at, timeZone)}
                </p>
                <p className="font-medium text-foreground">
                  {appointment.customers?.name ?? "Cliente removido"}
                </p>
                <p className="text-sm text-muted-foreground">
                  {appointment.services?.name ?? "Serviço removido"}
                  {" · "}
                  {appointment.professionals?.name ?? "Profissional removido"}
                </p>
              </div>
            </div>
            <div className="mt-3">{linkFor(appointment)}</div>
          </li>
        ))}
      </ul>

      {/* Desktop: tabela semântica. */}
      <div className="hidden sm:block">
        <Table>
          <TableCaption className="sr-only">
            Agendamentos pendentes de confirmação para amanhã
          </TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>Horário</TableHead>
              <TableHead>Cliente</TableHead>
              <TableHead>Serviço</TableHead>
              <TableHead>Profissional</TableHead>
              <TableHead className="text-right">Ação</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {appointments.map((appointment) => (
              <TableRow key={appointment.id}>
                <TableCell className="font-display tabular-nums text-foreground">
                  {formatTimeInTenantTz(appointment.starts_at, timeZone)}
                </TableCell>
                <TableCell className="font-medium text-foreground">
                  {appointment.customers?.name ?? "Cliente removido"}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {appointment.services?.name ?? "Serviço removido"}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {appointment.professionals?.name ?? "Profissional removido"}
                </TableCell>
                <TableCell className="text-right">
                  {linkFor(appointment)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
