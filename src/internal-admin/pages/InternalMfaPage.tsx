import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { Button } from "@/components/shadcn/ui/button";
import { MfaChallengeCard } from "@/components/shadcn/mfa/mfa-challenge-card";
import type {
  MfaMethod,
  MfaUserContext,
  MfaVerificationResult,
} from "@/components/shadcn/mfa/mfa-types";
import { supabase } from "@/lib/supabase";
import {
  MFA_MAX_ATTEMPTS,
  clearMfaPending,
  isMfaPendingValid,
  readMfaPending,
  remainingAttempts,
} from "@/internal-admin/internalOperator";

const LOCKOUT_MS = 5 * 60 * 1000;

/** Contexto estável enquanto o factor real não é resolvido (backend só tem TOTP). */
const INITIAL_CONTEXT: MfaUserContext = {
  userId: "",
  userEmail: "",
  preferredMethod: "totp",
  availableMethods: ["totp"],
};

/**
 * MFA interno: apresentação em `MfaChallengeCard` (Atlas Admin) com a variação
 * single-input. A página continua dona da prova real — `listFactors` →
 * `challenge` → `verify` —, do lockout (5 tentativas/5min), da janela
 * `mfa_pending` (≤10min) e dos redirects. SMS/backup/trust-device ficam
 * desligados porque o backend de operadores só suporta TOTP.
 */
export function InternalMfaPage() {
  const navigate = useNavigate();
  const [attempts, setAttempts] = useState(0);
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);
  const [noAuthenticator, setNoAuthenticator] = useState(false);
  const [pending, setPending] = useState(false);
  const [userContext, setUserContext] = useState<MfaUserContext>(INITIAL_CONTEXT);

  const locked = lockedUntil !== null && Date.now() < lockedUntil;

  // Janela `mfa_pending` (≤10min): sem carimbo válido não há MFA — limpa e
  // volta ao login sem revelar dado (TTL no cliente; prova real é a Edge
  // `verify-operator`, AAL2 server-side por request).
  useEffect(() => {
    const stored = readMfaPending(sessionStorage);
    if (!isMfaPendingValid(Date.now(), stored)) {
      clearMfaPending(sessionStorage);
      navigate("/internal-admin/login", { replace: true });
    }
  }, [navigate]);

  // Libera o lockout após 5 minutos sem exigir nova interação do operador.
  useEffect(() => {
    if (lockedUntil === null) return;
    const delay = Math.max(0, lockedUntil - Date.now());
    const timer = window.setTimeout(() => {
      setLockedUntil(null);
      setAttempts(0);
    }, delay);
    return () => window.clearTimeout(timer);
  }, [lockedUntil]);

  async function handleVerify({
    code,
  }: {
    code: string;
    method: MfaMethod;
    trustDevice: boolean;
  }): Promise<MfaVerificationResult> {
    if (locked || pending) {
      return { success: false, message: "Aguarde o fim do bloqueio e tente de novo." };
    }
    setNoAuthenticator(false);
    setPending(true);
    try {
      const { data: factors, error: factorsError } = await supabase.auth.mfa.listFactors();
      const totp = factors?.totp?.find((f) => f.status === "verified") ?? factors?.totp?.[0];
      if (factorsError || !totp) {
        setNoAuthenticator(true);
        return {
          success: false,
          message: "Nenhum autenticador ativo. Passe pela ativação primeiro.",
        };
      }
      // Contexto do card derivado do factor real; nunca expõe dado de tenant.
      setUserContext({
        userId: totp.id,
        userEmail: "",
        preferredMethod: "totp",
        availableMethods: ["totp"],
      });

      const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({
        factorId: totp.id,
      });
      if (challengeError || !challenge) {
        return {
          success: false,
          message: "Não foi possível verificar o código. Tente de novo.",
        };
      }

      const { error: verifyError } = await supabase.auth.mfa.verify({
        factorId: totp.id,
        challengeId: challenge.id,
        code,
      });
      if (verifyError) {
        const next = attempts + 1;
        setAttempts(next);
        if (next >= MFA_MAX_ATTEMPTS) {
          setLockedUntil(Date.now() + LOCKOUT_MS);
          return {
            success: false,
            message: "Muitas tentativas. Aguarde 5 minutos e tente de novo.",
          };
        }
        const restantes = remainingAttempts(next);
        return {
          success: false,
          message: `Código inválido. Restam ${restantes} tentativas.`,
          remainingAttempts: restantes,
        };
      }

      clearMfaPending(sessionStorage);
      return { success: true };
    } catch {
      return {
        success: false,
        message: "Não foi possível verificar o código. Tente de novo.",
      };
    } finally {
      setPending(false);
    }
  }

  return (
    <MfaChallengeCard
      userContext={userContext}
      onVerify={handleVerify}
      onCancel={() => navigate("/internal-admin/login", { replace: true })}
      onSuccess={() => navigate("/internal-admin", { replace: true })}
      inputMode="single"
      codeLabel="Código de 6 dígitos"
      codeMaxLength={6}
      title="Verificação em 2 etapas"
      titleAs="h1"
      description="Digite o código do seu autenticador."
      submitLabel="Verificar código"
      submitPendingLabel="Verificando…"
      submitClassName="min-h-[44px]"
      showTrustDevice={false}
      disabled={locked || pending}
      footer={
        <>
          {noAuthenticator ? (
            <Button
              type="button"
              variant="outline"
              className="min-h-[44px] w-full"
              onClick={() => navigate("/internal-admin/enroll")}
            >
              Ativar autenticador
            </Button>
          ) : null}
          {locked ? (
            <p role="status" className="text-center text-sm text-muted-foreground">
              Bloqueado temporariamente após 5 tentativas.
            </p>
          ) : null}
        </>
      }
    />
  );
}
