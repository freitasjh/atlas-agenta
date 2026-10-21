import * as React from "react";
import { useCallback, useEffect, useState } from "react";
import { CalendarDays, CalendarRange, List } from "lucide-react";

import { cn } from "@/lib/utils";

/** Visões disponíveis da agenda. */
export type AgendaView = "lista" | "dia" | "semana";

/** Chave de preferência por usuário (localStorage, nunca config de tenant). */
const STORAGE_KEY = "atlas:agenda-view";

const OPTIONS: { value: AgendaView; label: string; icon: typeof List }[] = [
  { value: "lista", label: "Lista", icon: List },
  { value: "dia", label: "Dia", icon: CalendarDays },
  { value: "semana", label: "Semana", icon: CalendarRange },
];

function isAgendaView(value: unknown): value is AgendaView {
  return value === "lista" || value === "dia" || value === "semana";
}

/**
 * Hook de preferência de visão **por usuário**: lê o default no primeiro render
 * (sem flash para a lista ao recarregar, AC-19) e persiste a escolha em
 * `localStorage`. No mobile o default é `lista` quando não há preferência
 * salva. Nunca é config de tenant.
 */
export function useAgendaView(): [AgendaView, (view: AgendaView) => void] {
  const [view, setViewState] = useState<AgendaView>(() => {
    if (typeof window === "undefined") return "lista";
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return isAgendaView(stored) ? stored : "lista";
  });

  const setView = useCallback((next: AgendaView) => {
    setViewState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // localStorage indisponível (modo privado): a visão segue só na sessão.
    }
  }, []);

  return [view, setView];
}

interface AgendaViewToggleProps {
  value: AgendaView;
  onChange: (view: AgendaView) => void;
}

/**
 * Alternador segmentado **Lista · Dia · Semana** (ADR-08). Grupo navegável por
 * teclado (setas movem o foco e a seleção), com `aria-pressed` por opção.
 * Troca a renderização sem recarregar; a persistência mora em `useAgendaView`.
 */
export function AgendaViewToggle({ value, onChange }: AgendaViewToggleProps) {
  const refs = React.useRef<(HTMLButtonElement | null)[]>([]);

  // Mantém o array de refs do tamanho das opções.
  useEffect(() => {
    refs.current = refs.current.slice(0, OPTIONS.length);
  }, []);

  function handleKeyDown(event: React.KeyboardEvent, index: number) {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    event.preventDefault();
    const delta = event.key === "ArrowRight" ? 1 : -1;
    const nextIndex = (index + delta + OPTIONS.length) % OPTIONS.length;
    const next = OPTIONS[nextIndex];
    onChange(next.value);
    refs.current[nextIndex]?.focus();
  }

  return (
    <div
      role="group"
      aria-label="Modo de visualização da agenda"
      className="inline-flex rounded-md bg-secondary p-1"
    >
      {OPTIONS.map((option, index) => {
        const Icon = option.icon;
        const active = option.value === value;
        return (
          <button
            key={option.value}
            ref={(node) => {
              refs.current[index] = node;
            }}
            type="button"
            aria-pressed={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-sm font-medium transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
              active
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="size-4" aria-hidden="true" />
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
