import * as React from "react";

import { cn } from "@/lib/utils";
import {
  resolveEmpresa,
  segmentTemplate,
  type TemplateVars,
} from "@/lib/message-templates";

interface TemplatePreviewProps {
  /** Corpo do template em edição (derivado de `form.watch("body")`). */
  body: string;
  /** Nome fantasia do tenant para a variável `{empresa}` (ou `null`). */
  empresa: string | null;
  /** Razão social do tenant: espelha o fallback `trade_name → legal_name` do servidor. */
  legalName?: string | null;
}

/** Dados de exemplo fixos pt-BR para o preview (o `{empresa}` vem do tenant). */
const EXAMPLE_VARS: Omit<Required<TemplateVars>, "empresa"> = {
  nome: "Maria Silva",
  servico: "Consulta",
  dataHora: "qui, 15/02 às 14:00",
};

/**
 * Prévia ao vivo do que o cliente recebe. Reatividade pura (deriva de `body`,
 * sem efeito). Segmentação via `segmentTemplate` (contrato compartilhado
 * ADR-03) — mesma lista fechada e fallback do envio. Realça as variáveis
 * substituídas por **fundo** (não só cor), com texto em `foreground` +
 * `font-medium` para contraste adequado. `{empresa}` segue o encadeamento
 * `trade_name → legal_name → null` do servidor (`resolveEmpresa`).
 */
export function TemplatePreview({
  body,
  empresa,
  legalName,
}: TemplatePreviewProps) {
  const segments = React.useMemo(
    () =>
      segmentTemplate(body, {
        ...EXAMPLE_VARS,
        empresa: resolveEmpresa(empresa, legalName),
      }),
    [body, empresa, legalName],
  );

  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-muted-foreground">
        Prévia (com dados de exemplo)
      </p>
      <div
        aria-live="polite"
        className="min-h-[72px] whitespace-pre-wrap break-words rounded-md border border-border bg-muted/40 p-3 text-sm text-foreground"
      >
        {body.trim() === "" ? (
          <span className="text-muted-foreground">
            O texto do modelo aparece aqui.
          </span>
        ) : (
          segments.map((segment, index) =>
            segment.kind === "var" ? (
              <span
                key={index}
                className={cn(
                  "rounded bg-primary/15 px-1 font-medium text-foreground",
                )}
              >
                {segment.value}
              </span>
            ) : (
              <React.Fragment key={index}>{segment.value}</React.Fragment>
            ),
          )
        )}
      </div>
    </div>
  );
}
