import { Link } from "react-router-dom";
import { Compass } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Logo } from "@/components/Logo";

/**
 * Rota curinga (404) em pt-BR. Mensagem clara + caminho de volta ao início.
 */
export function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background px-4 text-center text-foreground">
      <Logo />
      <div className="space-y-2">
        <p className="flex items-center justify-center gap-2 text-sm font-medium uppercase tracking-wide text-muted-foreground">
          <Compass className="h-4 w-4" aria-hidden="true" />
          Erro 404
        </p>
        <h1 className="font-display text-3xl font-semibold tracking-tight">
          Página não encontrada
        </h1>
        <p className="mx-auto max-w-md text-sm text-muted-foreground">
          O endereço que você tentou abrir não existe ou foi movido. Verifique o
          link ou volte para o início.
        </p>
      </div>
      <Button asChild>
        <Link to="/">Voltar para o início</Link>
      </Button>
    </div>
  );
}
