import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Copy, Loader2 } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/lib/supabase";
import { clearMfaPending } from "@/internal-admin/internalOperator";

/**
 * Enroll TOTP em 3 passos (ux: QR exibido 1x + chave copiável + gate de backup
 * por checkbox antes de ativar; 1 primário por tela; foco no primeiro inválido).
 */
const STEPS = ["Ativar autenticador", "Confirmar código", "Guardar backup"] as const;

export function InternalEnrollPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [qr, setQr] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [factorId, setFactorId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [backupChecked, setBackupChecked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [copied, setCopied] = useState(false);
  const alertRef = useRef<HTMLParagraphElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (error) alertRef.current?.focus();
  }, [error]);

  async function startEnroll() {
    setError(null);
    setPending(true);
    try {
      const { data, error: enrollError } = await supabase.auth.mfa.enroll({ factorType: "totp" });
      if (enrollError || !data) {
        setError("Não foi possível iniciar a ativação. Tente de novo.");
        return;
      }
      setFactorId(data.id);
      setQr(data.totp.qr_code);
      setSecret(data.totp.secret);
      setStep(1);
      window.setTimeout(() => codeRef.current?.focus(), 0);
    } catch {
      setError("Não foi possível iniciar a ativação. Tente de novo.");
    } finally {
      setPending(false);
    }
  }

  async function confirmCode() {
    if (!factorId || code.trim().length < 6) {
      setError("Digite o código de 6 dígitos do autenticador.");
      codeRef.current?.focus();
      return;
    }
    setError(null);
    setPending(true);
    try {
      const { data: challengeData, error: challengeError } = await supabase.auth.mfa.challenge({ factorId });
      if (challengeError || !challengeData) {
        setError("Não foi possível validar. Tente de novo.");
        codeRef.current?.focus();
        return;
      }
      const { error: verifyError } = await supabase.auth.mfa.verify({
        factorId,
        challengeId: challengeData.id,
        code: code.trim(),
      });
      if (verifyError) {
        setError("Código inválido. Confira no autenticador e tente de novo.");
        codeRef.current?.focus();
        codeRef.current?.select();
        return;
      }
      setStep(2);
    } catch {
      setError("Não foi possível validar. Tente de novo.");
    } finally {
      setPending(false);
    }
  }

  function finish() {
    clearMfaPending(sessionStorage);
    navigate("/internal-admin", { replace: true });
  }

  async function copySecret() {
    if (!secret) return;
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-display text-2xl">Ativar verificação em 2 etapas</CardTitle>
        <CardDescription>
          Passo {step + 1} de {STEPS.length}: {STEPS[step]}.
        </CardDescription>
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

        {step === 0 ? (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Você vai ligar o autenticador (TOTP) desta conta. O QR aparece uma única vez.
            </p>
            <Button onClick={startEnroll} className="min-h-[44px] w-full" disabled={pending}>
              {pending ? (
                <>
                  <Loader2 className="animate-spin" aria-hidden="true" />
                  Gerando…
                </>
              ) : (
                "Gerar QR de ativação"
              )}
            </Button>
          </div>
        ) : null}

        {step === 1 ? (
          <div className="space-y-4">
            {qr ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={qr} alt="QR de ativação do autenticador" className="mx-auto h-48 w-48" />
            ) : null}
            {secret ? (
              <div className="flex items-center gap-2">
                <Input value={secret} readOnly aria-label="Chave de ativação" className="font-mono text-xs" />
                <Button type="button" variant="outline" size="icon" onClick={copySecret} aria-label="Copiar chave">
                  <Copy className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            ) : null}
            {copied ? (
              <p role="status" className="text-sm text-muted-foreground">
                Chave copiada.
              </p>
            ) : null}
            <div className="space-y-2">
              <label htmlFor="internal-enroll-code" className="text-sm font-medium">
                Código do autenticador
              </label>
              <Input
                id="internal-enroll-code"
                ref={codeRef}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 8))}
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="123456"
                className="text-center text-lg tracking-widest tabular-nums"
              />
            </div>
            <Button onClick={confirmCode} className="min-h-[44px] w-full" disabled={pending}>
              {pending ? (
                <>
                  <Loader2 className="animate-spin" aria-hidden="true" />
                  Confirmando…
                </>
              ) : (
                "Confirmar código"
              )}
            </Button>
          </div>
        ) : null}

        {step === 2 ? (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Guarde a chave em um local seguro. Sem ela, a recuperação exige outro operador.
            </p>
            <div className="flex items-start gap-2">
              <Checkbox
                id="internal-enroll-backup"
                checked={backupChecked}
                onCheckedChange={(v) => setBackupChecked(v === true)}
              />
              <label htmlFor="internal-enroll-backup" className="text-sm">
                Guardei a chave de recuperação em local seguro.
              </label>
            </div>
            <Button onClick={finish} className="min-h-[44px] w-full" disabled={!backupChecked}>
              Concluir ativação
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
