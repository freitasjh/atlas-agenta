import * as React from "react";

interface StatePanelProps {
  titulo: string;
  descricao: string;
  /** Slot de ação (ex.: botão "Tentar novamente"). */
  children?: React.ReactNode;
}

/**
 * Painel de estado (vazio/erro), no mesmo molde das telas de `/app`. Promovido
 * de dentro da `AgendaPage` (onde era privado) para ser compartilhado pela
 * agenda e pelo dashboard — extração aditiva, mesma marcação e props. O slot
 * `children` recebe a ação (ex.: "Tentar novamente").
 */
export function StatePanel({ titulo, descricao, children }: StatePanelProps) {
  return (
    <div className="mx-auto w-full max-w-2xl rounded-lg border border-dashed border-border p-8 text-center">
      <h2 className="font-display text-lg font-semibold tracking-tight">
        {titulo}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">{descricao}</p>
      {children ? (
        <div className="mt-4 flex justify-center">{children}</div>
      ) : null}
    </div>
  );
}
