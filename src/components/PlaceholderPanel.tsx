import * as React from "react";
import { Hammer } from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface PlaceholderPanelProps {
  titulo: string;
  descricao: string;
  /** Conteúdo opcional (ex.: amostra de badges na casca da agenda). */
  children?: React.ReactNode;
}

/**
 * Casca "em construção" reutilizável por todas as telas-casca (ADR-05).
 * Textos em pt-BR.
 */
export function PlaceholderPanel({
  titulo,
  descricao,
  children,
}: PlaceholderPanelProps) {
  return (
    <Card className="mx-auto w-full max-w-2xl">
      <CardHeader>
        <div className="flex items-center gap-2 text-primary">
          <Hammer className="h-4 w-4" aria-hidden="true" />
          <span className="text-xs font-medium uppercase tracking-wide">
            Em construção
          </span>
        </div>
        <CardTitle>{titulo}</CardTitle>
        <CardDescription>{descricao}</CardDescription>
      </CardHeader>
      {children ? <CardContent>{children}</CardContent> : null}
    </Card>
  );
}
