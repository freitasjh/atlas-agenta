import * as React from "react";

import { cn } from "@/lib/utils";
import {
  TEMPLATE_FALLBACKS,
  TEMPLATE_VARIABLES,
  type TemplateVariable,
  type TemplateVars,
} from "@/lib/message-templates";

interface TemplatePreviewProps {
  /** Corpo do template em edição (derivado de `form.watch("body")`). */
  body: string;
  /** Nome fantasia do tenant para a variável `{empresa}` (ou `null`). */
  empresa: string | null;
}

/** Dados de exemplo fixos pt-BR para o preview (o `{empresa}` vem do tenant). */
const EXAMPLE_VARS: Omit<Required<TemplateVars>, "empresa"> = {
  nome: "Maria Silva",
  servico: "Consulta",
  dataHora: "qui, 15/02 às 14:00",
};

const KNOWN = new Set<string>(TEMPLATE_VARIABLES);
const TOKEN_PATTERN = /\{([a-zA-Z][a-zA-Z0-9_]*)\}/g;

type Segment =
  | { kind: "text"; value: string }
  | { kind: "var"; value: string };

/**
 * Segmenta o corpo em texto literal e trechos resolvidos de variáveis
 * conhecidas, aplicando a MESMA tabela de fallback de `renderTemplate` (ADR-03).
 * Token desconhecido fica literal (vira texto). Nunca expõe `{token}` conhecido
 * cru — espelha a semântica canônica, só que preservando quais trechos foram
 * substituídos para o realce visual.
 */
function segmentPreview(body: string, vars: TemplateVars): Segment[] {
  const segments: Segment[] = [];
  let lastIndex = 0;
  for (const match of body.matchAll(TOKEN_PATTERN)) {
    const [raw, name] = match;
    const start = match.index ?? 0;
    if (!KNOWN.has(name)) {
      // Token desconhecido: mantém literal (parte do texto comum).
      continue;
    }
    if (start > lastIndex) {
      segments.push({ kind: "text", value: body.slice(lastIndex, start) });
    }
    const variable = name as TemplateVariable;
    const value = vars[variable];
    const resolved =
      value != null && value.trim() !== ""
        ? value
        : TEMPLATE_FALLBACKS[variable];
    segments.push({ kind: "var", value: resolved });
    lastIndex = start + raw.length;
  }
  if (lastIndex < body.length) {
    segments.push({ kind: "text", value: body.slice(lastIndex) });
  }
  return segments;
}

/**
 * Prévia ao vivo do que o cliente recebe. Reatividade pura (deriva de `body`,
 * sem efeito). Realça as variáveis substituídas por **fundo** (não só cor), com
 * texto em `foreground` + `font-medium` para contraste adequado.
 */
export function TemplatePreview({ body, empresa }: TemplatePreviewProps) {
  const segments = React.useMemo(
    () => segmentPreview(body, { ...EXAMPLE_VARS, empresa }),
    [body, empresa],
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
