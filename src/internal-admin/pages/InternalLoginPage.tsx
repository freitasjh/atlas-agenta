import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

import { CardContent } from "@/components/ui/card";
import { AuthCard } from "@/components/shadcn/auth/auth-card";
import { LoginForm } from "@/components/shadcn/auth/login-form";
import { supabase } from "@/lib/supabase";
import { GENERIC_LOGIN_ERROR, writeMfaPending } from "@/internal-admin/internalOperator";

const schema = z.object({
  email: z.string().email("Informe um e-mail válido."),
  password: z.string().min(1, "Informe a senha."),
});

type Input = z.infer<typeof schema>;

/**
 * Login interno: apresentação em `AuthCard` + `LoginForm` (Atlas Admin,
 * arquétipo 5). A lógica permanece aqui — RHF/zod local, anti-enumeração por
 * timing (≥400ms), erro único, janela `mfa_pending` (≤10min) e redirect para o
 * MFA. Nenhum dado operacional é liberado nesta etapa.
 */
export function InternalLoginPage() {
  const navigate = useNavigate();
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const alertRef = useRef<HTMLParagraphElement>(null);

  const form = useForm<Input>({
    resolver: zodResolver(schema),
    defaultValues: { email: "", password: "" },
  });

  useEffect(() => {
    if (serverError) alertRef.current?.focus();
  }, [serverError]);

  async function onSubmit(values: Input) {
    setServerError(null);
    setPending(true);
    const startedAt = Date.now();
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: values.email,
        password: values.password,
      });
      // Tempo de resposta idêntico nos dois casos (anti-enumeração por timing).
      const elapsed = Date.now() - startedAt;
      if (elapsed < 400) await new Promise((r) => setTimeout(r, 400 - elapsed));
      if (error) {
        setServerError(GENERIC_LOGIN_ERROR);
        return;
      }
      writeMfaPending(sessionStorage);
      navigate("/internal-admin/mfa", { replace: true });
    } catch {
      setServerError(GENERIC_LOGIN_ERROR);
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthCard>
      <CardContent className="p-6 sm:p-8">
        <LoginForm
          form={form}
          onSubmit={onSubmit}
          isPending={pending}
          error={serverError}
          errorRef={alertRef}
          title="Área interna"
          description="Entrada exclusiva de operadores."
          showForgotPassword={false}
          showSignupLink={false}
          submitClassName="min-h-[44px]"
        />
      </CardContent>
    </AuthCard>
  );
}
