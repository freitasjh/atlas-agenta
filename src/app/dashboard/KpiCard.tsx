import * as React from "react";

import { Card, CardContent } from "@/components/ui/card";

/**
 * Card sóbrio de KPI (analysis-frontend §2.2): valor em `font-display
 * tabular-nums`, rótulo em `text-sm text-muted-foreground`, com slots opcionais
 * para um comparativo (`DeltaBadge`) e para conteúdo extra (ex.: a quebra por
 * status ou a lista por profissional). É `<article>` com `aria-label` em pt-BR
 * para o leitor de tela anunciar rótulo + valor. Cada card trata o próprio
 * conteúdo; a orquestração dos estados fica em `DashboardPage`.
 */

interface KpiCardProps {
  rotulo: string;
  /** Valor principal já formatado (ex.: "12,5%", "34"). */
  valor: string;
  /** Texto de apoio abaixo do valor (ex.: denominador, legenda). */
  apoio?: string;
  /** `aria-label` completo; se ausente, deriva de `rotulo` + `valor`. */
  ariaLabel?: string;
  /** Slot de comparativo (DeltaBadge) ou conteúdo extra (quebra por status). */
  children?: React.ReactNode;
}

export function KpiCard({
  rotulo,
  valor,
  apoio,
  ariaLabel,
  children,
}: KpiCardProps) {
  return (
    <Card role="group" aria-label={ariaLabel ?? `${rotulo}: ${valor}`}>
      <CardContent className="space-y-2 p-5">
        <p className="text-sm font-medium text-muted-foreground">{rotulo}</p>
        <p
          className="font-display text-3xl font-semibold tabular-nums tracking-tight text-foreground"
          aria-hidden="true"
        >
          {valor}
        </p>
        {apoio ? (
          <p className="text-xs text-muted-foreground" aria-hidden="true">
            {apoio}
          </p>
        ) : null}
        {children ? <div className="pt-1">{children}</div> : null}
      </CardContent>
    </Card>
  );
}
