import { Link } from "react-router-dom";

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { AvailableSlot } from "@/lib/scheduling-slots";

/**
 * Motivo de a lista de slots estar vazia, usado para escolher a mensagem pt-BR
 * (análise frontend §3.4/§6). Distinto de `null`, que significa "ainda não é
 * possível ofertar" (faltam profissional/serviço/dia — estado-guia).
 */
export type SlotEmptyReason =
  | "folga"
  | "fora-vigencia"
  | "sem-grade"
  | "sem-slots";

interface SlotPickerProps {
  /** Slots já calculados por `useAvailableSlots` (ADR-05). */
  slots: AvailableSlot[];
  /** Alguma leitura de insumo ainda está carregando. */
  isLoading: boolean;
  /** Pronto para ofertar (profissional + serviço + dia definidos). */
  isEnabled: boolean;
  /** Por que não há slots, quando `isEnabled` e a lista está vazia. */
  emptyReason: SlotEmptyReason | null;
  /** `HH:MM` do slot selecionado (campo `time` do form), ou vazio. */
  value: string;
  /** Emite o `HH:MM` do slot escolhido. */
  onSelect: (time: string) => void;
  /** Rota para configurar a grade, exibida no estado `sem-grade` quando o papel permite. */
  configureScheduleHref?: string;
}

/** Copy pt-BR por motivo de vazio (análise frontend §6). */
const EMPTY_MESSAGE: Record<SlotEmptyReason, string> = {
  folga: "O profissional não atende nesta data.",
  "fora-vigencia": "Fora do período de atendimento do profissional.",
  "sem-grade": "Este profissional ainda não tem grade de horários.",
  "sem-slots": "Nenhum horário livre para este serviço neste dia.",
};

/**
 * Seletor de horários livres (RF-AG-05 / ADR-06). Componente **controlado e
 * presentacional**: recebe os slots já calculados + o estado de
 * carregamento/vazio e emite o `HH:MM` escolhido. Não lê dados nem converte
 * fuso — isso mora em `useAvailableSlots` (ADR-05).
 *
 * Acessibilidade: o grupo de chips é um `radiogroup` (`aria-label="Horários
 * livres"`); cada chip é um `radio` com foco visível; `Enter`/`Espaço`
 * selecionam (comportamento nativo do `<button>`). Slot indisponível é
 * **omitido**, nunca renderizado desabilitado.
 */
export function SlotPicker({
  slots,
  isLoading,
  isEnabled,
  emptyReason,
  value,
  onSelect,
  configureScheduleHref,
}: SlotPickerProps) {
  // Estado-guia: faltam profissional/serviço/dia.
  if (!isEnabled) {
    return (
      <p className="text-sm text-muted-foreground">
        Escolha profissional, serviço e data para ver os horários livres.
      </p>
    );
  }

  if (isLoading) {
    return (
      <div
        className="flex flex-wrap gap-2"
        aria-busy="true"
        aria-label="Carregando horários livres"
      >
        {Array.from({ length: 8 }).map((_, index) => (
          <Skeleton key={index} className="h-9 w-16" />
        ))}
      </div>
    );
  }

  if (slots.length === 0) {
    const reason = emptyReason ?? "sem-slots";
    return (
      <p className="text-sm text-muted-foreground">
        {EMPTY_MESSAGE[reason]}{" "}
        {reason === "sem-grade" && configureScheduleHref ? (
          <Link
            to={configureScheduleHref}
            className="font-medium text-foreground underline underline-offset-4"
          >
            Configurar horários
          </Link>
        ) : null}
      </p>
    );
  }

  return (
    <div
      role="radiogroup"
      aria-label="Horários livres"
      className="flex flex-wrap gap-2"
    >
      {slots.map((slot) => {
        const selected = slot.label === value;
        return (
          <button
            key={slot.startUtc}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onSelect(slot.label)}
            className={cn(
              "inline-flex h-9 items-center justify-center rounded-md border px-3 text-sm font-medium tabular-nums transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              selected
                ? "border-primary bg-primary text-primary-foreground"
                : "border-input bg-background hover:bg-accent hover:text-accent-foreground",
            )}
          >
            {slot.label}
          </button>
        );
      })}
    </div>
  );
}
