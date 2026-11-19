import { useId } from "react";
import { Link } from "react-router-dom";

import { StatePanel } from "@/components/StatePanel";
import { Button } from "@/components/ui/button";

interface EntitlementGateProps {
  /**
   * `true` = recurso liberado (renderiza só o conteúdo).
   * `false`/`null` = sem acesso (conteúdo segue legível + empty com upsell,
   * nunca hide silencioso; `null` degrada sem travar).
   */
  entitled: boolean | null;
  /** Nome do recurso em pt-BR (ex.: "Prontuário"). Sem PII. */
  recurso: string;
  /** Conteúdo legível — sempre renderizado, mesmo bloqueado. */
  children?: React.ReactNode;
  /** Rótulo da ação de escrita bloqueada (ex.: "Novo registro"). */
  acaoLabel?: string;
  /**
   * Descrição do upsell. Padrão fala em conteúdo gravado + criar/editar;
   * recursos somente leitura (ex.: DRE) passam a própria copy.
   */
  descricao?: string;
}

/**
 * Gating só-UI por entitlement (ADR-01, pattern reutilizável G4/G6/G5):
 * conteúdo gravado segue legível, só a escrita bloqueia (botão desabilitado
 * com explicação acessível) + upsell para `/precos`. Nunca esconde o conteúdo,
 * nunca dispara request, nunca decide acesso real (isso é RLS).
 */
export function EntitlementGate({
  entitled,
  recurso,
  children,
  acaoLabel = "Novo registro",
  descricao = "O conteúdo gravado continua visível. Para criar ou editar, fale com o responsável pelo plano.",
}: EntitlementGateProps) {
  const descricaoId = useId();

  if (entitled === true) return <>{children}</>;

  return (
    <div className="space-y-4">
      {children}
      <StatePanel titulo={`${recurso}: recurso não incluído no plano atual`} descricao={descricao}>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <span title={`Disponível nos planos com ${recurso.toLowerCase()} liberado`}>
            <Button
              type="button"
              variant="outline"
              disabled
              aria-describedby={descricaoId}
            >
              {acaoLabel} (bloqueado)
            </Button>
          </span>
          <Button asChild>
            <Link to="/precos">Ver planos</Link>
          </Button>
        </div>
      </StatePanel>
      <p id={descricaoId} className="sr-only">
        Ação bloqueada porque o plano atual não inclui {recurso.toLowerCase()}.
        O conteúdo existente permanece legível.
      </p>
    </div>
  );
}
