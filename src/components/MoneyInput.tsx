import * as React from "react";

import { Input } from "@/components/ui/input";
import { formatCentsToBRL, parseBRLToCents } from "@/lib/money";

export interface MoneyInputProps
  extends Omit<React.ComponentProps<"input">, "value" | "onChange" | "type"> {
  /** Valor em **centavos inteiros** (fonte da verdade do form). */
  value: number;
  /** Emite o valor em **centavos inteiros** a cada edição. */
  onChange: (cents: number) => void;
}

/**
 * Input de dinheiro: exibe/edita em **R$** (pt-BR) e emite **centavos inteiros**
 * para o react-hook-form. Nenhum float trafega — a conversão reais↔centavos
 * fica confinada aqui.
 *
 * Mantém um buffer de texto local enquanto o campo está em foco (para o usuário
 * digitar livremente, inclusive a vírgula) e reexibe o valor formatado no blur.
 */
export const MoneyInput = React.forwardRef<HTMLInputElement, MoneyInputProps>(
  ({ value, onChange, onFocus, onBlur, ...props }, ref) => {
    const [draft, setDraft] = React.useState<string | null>(null);

    // Fora de foco: mostra o valor canônico formatado. Em foco: mostra o draft.
    const display = draft ?? formatCentsToBRL(value);

    return (
      <Input
        ref={ref}
        inputMode="decimal"
        value={display}
        onFocus={(event) => {
          // Entra em edição com o valor em reais cru (sem símbolo), mais fácil de editar.
          setDraft((value / 100).toFixed(2).replace(".", ","));
          onFocus?.(event);
        }}
        onChange={(event) => {
          const next = event.target.value;
          setDraft(next);
          const cents = parseBRLToCents(next);
          // Campo vazio/ilegível vira 0 centavos; a validação zod barra o que precisar.
          onChange(cents ?? 0);
        }}
        onBlur={(event) => {
          setDraft(null);
          onBlur?.(event);
        }}
        {...props}
      />
    );
  },
);
MoneyInput.displayName = "MoneyInput";
