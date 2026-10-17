import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { ShieldAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Logo } from "@/components/Logo";

interface AccessDeniedProps {
  /** Rota para onde o botão de volta aponta (área permitida ao usuário). */
  backTo?: string;
  /** Texto do botão de volta. */
  backLabel?: string;
}

/**
 * Tela 403 "Acesso restrito" em pt-BR. Espelha o `NotFound`: resposta honesta e
 * nomeada em vez de redirect silencioso quando o papel do usuário não autoriza
 * a rota. Move o foco para o `<h1>` ao montar (acessibilidade: leitor de tela
 * anuncia o novo contexto).
 */
export function AccessDenied({
  backTo = "/",
  backLabel = "Voltar",
}: AccessDeniedProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background px-4 text-center text-foreground">
      <Logo />
      <div className="space-y-2">
        <p className="flex items-center justify-center gap-2 text-sm font-medium uppercase tracking-wide text-muted-foreground">
          <ShieldAlert className="h-4 w-4" aria-hidden="true" />
          Erro 403
        </p>
        <h1
          ref={headingRef}
          tabIndex={-1}
          className="font-display text-3xl font-semibold tracking-tight outline-none"
        >
          Acesso restrito
        </h1>
        <p className="mx-auto max-w-md text-sm text-muted-foreground">
          Você não tem permissão para acessar esta área. Se acredita que isso é
          um engano, fale com o administrador da sua conta.
        </p>
      </div>
      <Button asChild>
        <Link to={backTo}>{backLabel}</Link>
      </Button>
    </div>
  );
}
