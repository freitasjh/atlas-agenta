import * as React from "react";

import { cn } from "@/lib/utils";

interface PageHeaderProps {
  titulo: string;
  descricao?: string;
  /** Ações à direita (botões, etc.). */
  acoes?: React.ReactNode;
  className?: string;
}

/**
 * Cabeçalho de página: título, descrição opcional e slot de ações.
 */
export function PageHeader({
  titulo,
  descricao,
  acoes,
  className,
}: PageHeaderProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between",
        className,
      )}
    >
      <div className="space-y-1">
        <h1 className="font-display text-2xl font-semibold tracking-tight">
          {titulo}
        </h1>
        {descricao ? (
          <p className="text-sm text-muted-foreground">{descricao}</p>
        ) : null}
      </div>
      {acoes ? <div className="flex items-center gap-2">{acoes}</div> : null}
    </div>
  );
}
