import { Check } from "lucide-react";

import { cn } from "@/lib/utils";
import type { Appointment } from "@/types/domain";

/**
 * Micro-selo "confirmado pelo cliente no WhatsApp" (Fatia 2, PRD §2.2/§8).
 * Renderiza APENAS quando o agendamento está `confirmado` E a origem é
 * `confirmed_via === 'cliente_whatsapp'` (determinístico pela coluna; `manual`
 * ou `null` não ganham selo — só o `StatusBadge` "Confirmado").
 *
 * A distinção nunca é por cor sozinha: há ícone + `aria-label`. O selo é
 * decorativo quanto a foco (não entra na ordem de tab; o alvo focável continua
 * sendo o `<button>`/linha que o contém). Reusa o token de status já calibrado
 * `--status-confirmado`, sem token novo.
 */
export function ClientConfirmedBadge({
  appointment,
  className,
}: {
  appointment: Pick<Appointment, "status" | "confirmed_via">;
  className?: string;
}) {
  if (
    appointment.status !== "confirmado" ||
    appointment.confirmed_via !== "cliente_whatsapp"
  ) {
    return null;
  }

  return (
    <span
      role="img"
      aria-label="Confirmado pelo cliente no WhatsApp"
      title="Confirmado pelo cliente no WhatsApp"
      className={cn(
        "inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-status-confirmado text-status-confirmado-foreground",
        className,
      )}
    >
      <Check aria-hidden="true" className="size-3" />
    </span>
  );
}
