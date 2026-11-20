import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

interface SchedulePanelProps {
  children: ReactNode;
  className?: string;
}

/** Casca visual compartilhada dia/semana: borda suave e brilho superior. */
export function SchedulePanel({ children, className }: SchedulePanelProps) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-xl border border-border/70 bg-card shadow-xs",
        className,
      )}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 z-30 h-px bg-gradient-to-r from-transparent via-foreground/15 to-transparent"
      />
      {children}
    </div>
  );
}

/** Iniciais estáveis para o avatar textual (sem asset externo). */
export function professionalInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ""}${parts[parts.length - 1][0] ?? ""}`.toUpperCase();
}

interface ScheduleProfessionalHeaderProps {
  name: string;
  count: number;
  className?: string;
}

/** Cabeçalho de coluna no estilo do scheduler: avatar, nome e volume do dia. */
export function ScheduleProfessionalHeader({
  name,
  count,
  className,
}: ScheduleProfessionalHeaderProps) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <span
        aria-hidden="true"
        className="flex size-9 shrink-0 items-center justify-center rounded-full border border-border/80 bg-muted/60 text-[11px] font-semibold text-foreground"
      >
        {professionalInitials(name)}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-xs font-semibold tracking-tight text-foreground">
          {name}
        </span>
        <span className="block truncate text-[11px] text-muted-foreground">
          {count} {count === 1 ? "agendamento" : "agendamentos"}
        </span>
      </span>
    </div>
  );
}

/** Selo da linha do agora; o horário também vai em texto para leitor de tela. */
export function ScheduleNowBadge({ label }: { label: string }) {
  return (
    <span className="rounded bg-primary px-1.5 py-0.5 font-mono text-[9px] font-bold tabular-nums text-primary-foreground">
      {label}
    </span>
  );
}
