import { useCallback, useEffect, useState } from "react";

import type { AppointmentSelection } from "@/lib/validations/scheduling";

/** Conteúdo mínimo do rascunho de criação (espelha `AppointmentInput`). */
export interface AppointmentDraft {
  customerId: string;
  professionalId: string;
  selection: AppointmentSelection;
  date: string;
  time: string;
}

/** Chave do rascunho: por tenant + dia (nunca vaza entre empresas/dias). */
export function draftKey(tenantId: string, day: string): string {
  return `atlas-agenda:appointment-draft:${tenantId}:${day}`;
}

function readDraft(key: string | null): AppointmentDraft | null {
  if (!key) return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AppointmentDraft;
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof parsed.date !== "string"
    ) {
      return null;
    }
    return parsed;
  } catch {
    // JSON corrompido: trata como ausente (o próximo save sobrescreve).
    return null;
  }
}

/**
 * Rascunho de criação do agendamento em `localStorage`. Sobrevive a reload e
 * é limpo no salvar/descartar. Sem tenant (sessão não resolvida) vira no-op.
 */
export function useAppointmentDraft(tenantId: string | null, day: string) {
  const key = tenantId ? draftKey(tenantId, day) : null;
  const [draft, setDraft] = useState<AppointmentDraft | null>(() =>
    readDraft(key),
  );

  // tenantId pode resolver após o mount (sessão ainda carregando): o
  // `useState` inicial lê uma única vez, então relê quando a chave mudar.
  useEffect(() => {
    setDraft(readDraft(key));
  }, [key]);

  const save = useCallback(
    (next: AppointmentDraft) => {
      if (!key) return;
      try {
        window.localStorage.setItem(key, JSON.stringify(next));
      } catch {
        // Quota/privado: rascunho é conveniência, nunca trava o fluxo.
      }
      setDraft(next);
    },
    [key],
  );

  const clear = useCallback(() => {
    if (key) {
      try {
        window.localStorage.removeItem(key);
      } catch {
        // no-op: limpeza é melhor-esforço.
      }
    }
    setDraft(null);
  }, [key]);

  return { draft, hasDraft: draft !== null, save, clear };
}
