import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/lib/supabase";
import {
  MFA_MAX_ATTEMPTS,
  clearMfaPending,
  isMfaPendingValid,
  readMfaPending,
  remainingAttempts,
} from "@/internal-admin/internalOperator";

/**
 * MFA interno (ux: OTP single-input numérico com `autocomplete="one-time-code"`,
 * tabular-nums; 5 tentativas + lockout com timer; erro com restantes + foco no
 * campo; 1 primário; CTA ≥44px).
 */
export function InternalMfaPage() {
  const navigate = useNavigate();
  const [code, setCode] = useState("");
  const [attempts, setAttempts] = useState(0);
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const alertRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Janela `mfa_pending` (≤10min): sem carimbo válido não há MFA — limpa e
  // volta ao login sem revelar dado (TTL imposto no cliente; a prova real é
  // a Edge `verify-operator`, AAL2 server-side por request).
  useEffect(() => {
    const stored = readMfaPending(sessionStorage);
    if (!isMfaPendingValid(Date.now(), stored)) {
      clearMfaPending(sessionStorage);
      navigate("/internal-admin/login", { replace: true });
    }
  }, [navigate]);

  useEffect(() => {
    if (error) alertRef.current?.focus();
  }, [error]);

  const locked = lockedUntil !== null && Date.now() < lockedUntil;

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (locked || pending) return;
    setError(null);
    setPending(true);
    try {
      const { data: factors, error: factorsError } = await supabase.auth.mfa.listFactors();
      const totp = factors?.totp?.find((f) => f.status === "verified") ?? factors?.totp?.[0];
      if (factorsError || !totp) {
        setError("Nenhum autenticador ativo. Passe pela ativação primeiro.");
        return;
      }
      const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({
        factorId: totp.id,
      });
      if (challengeError || !challenge) {
        setError("Não foi possível verificar o código. Tente de novo.");
        inputRef.current?.focus();
        return;
      }
      const { error: verifyError } = await supabase.auth.mfa.verify({
        factorId: totp.id,
        challengeId: challenge.id,
        code: code.trim(),
      });
      if (verifyError) {
        const next = attempts + 1;
        setAttempts(next);
        if (next >= MFA_MAX_ATTEMPTS) {
          setLockedUntil(Date.now() + 5 * 60 * 1000);
          setError("Muitas tentativas. Aguarde 5 minutos e tente de novo.");
        } else {
          setError(`Código inválido. Restam ${remainingAttempts(next)} tentativas.`);
        }
        inputRef.current?.focus();
        inputRef.current?.select();
        return;
      }
      clearMfaPending(sessionStorage);
      navigate("/internal-admin", { replace: true });
    } catch {
      setError("Não foi possível verificar o código. Tente de novo.");
      inputRef.current?.focus();
    } finally {
      setPending(false);
    }
  }

  function handlePaste(event: React.ClipboardEvent<HTMLInputElement>) {
    const text = event.clipboardData.getData("text").trim();
    if (/^\d{6,8}$/.test(text)) {
      event.preventDefault();
      setCode(text);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-display text-2xl">Verificação em 2 etapas</CardTitle>
        <CardDescription>Digite o código do seu autenticador.</CardDescription>
      </CardHeader>
      <CardContent>
        {error ? (
          <p
            ref={alertRef}
            role="alert"
            tabIndex={-1}
            aria-live="assertive"
            className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            {error}
          </p>
        ) : null}
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <div className="space-y-2">
            <label htmlFor="internal-mfa-code" className="text-sm font-medium">
              Código de 6 dígitos
            </label>
            <Input
              id="internal-mfa-code"
              ref={inputRef}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 8))}
              onPaste={handlePaste}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="123456"
              aria-describedby={error ? "internal-mfa-error" : undefined}
              className="text-center text-lg tracking-widest tabular-nums"
              disabled={locked || pending}
            />
          </div>
          <Button type="submit" className="min-h-[44px] w-full" disabled={locked || pending || code.trim().length < 6}>
            {pending ? (
              <>
                <Loader2 className="animate-spin" aria-hidden="true" />
                Verificando…
              </>
            ) : (
              "Verificar código"
            )}
          </Button>
          {locked ? (
            <p role="status" className="text-center text-sm text-muted-foreground">
              Bloqueado temporariamente após 5 tentativas.
            </p>
          ) : null}
        </form>
      </CardContent>
    </Card>
  );
}
