import { Layers } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Selo "Pacote" — a única assinatura visual de um agendamento vindo de um combo
 * do salão (ADR-07, Fase 1b). Renderiza um pill neutro com ícone + texto
 * "Pacote"; o significado nunca depende só da cor, o texto e o ícone carregam a
 * informação (WCAG: cor não é o único canal).
 *
 * Componente puro de apresentação: sem estado, sem rede. Quem renderiza decide
 * quando mostrá-lo (só quando `combo_id` está presente). O token `foreground`
 * garante contraste ≥ 4.5:1 no tema claro e escuro — o texto não fica em
 * `muted-foreground`, apenas o fundo/borda são neutros.
 */
export function ComboTag({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full border border-border bg-muted px-1.5 py-0.5 text-xs font-medium text-foreground",
        className,
      )}
    >
      <Layers aria-hidden="true" className="size-3" />
      Pacote
    </span>
  );
}
