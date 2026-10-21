import { Badge } from "@/components/ui/badge";
import { TEMPLATE_VARIABLE_META } from "@/lib/message-templates";

interface VariableChipsProps {
  /** Insere o token na posição atual do cursor do textarea. */
  onInsert: (token: string) => void;
  /** Desabilita os chips enquanto o formulário salva. */
  disabled?: boolean;
}

/**
 * Barra de chips das variáveis da lista fechada (ADR-03). Cada chip é um
 * `<button type="button">` que insere o `{token}` na posição do cursor do
 * `Textarea`. Nome acessível = o próprio token (mono); teclado por
 * `Enter`/`Espaço` herdado do botão nativo.
 */
export function VariableChips({ onInsert, disabled }: VariableChipsProps) {
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="Variáveis">
      {TEMPLATE_VARIABLE_META.map(({ token, label }) => (
        <button
          key={token}
          type="button"
          disabled={disabled}
          onClick={() => onInsert(token)}
          title={label}
          aria-label={`Inserir ${label}`}
          className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Badge
            variant="secondary"
            className="cursor-pointer font-mono text-xs hover:bg-secondary/70"
          >
            {token}
          </Badge>
        </button>
      ))}
    </div>
  );
}
