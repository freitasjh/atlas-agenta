import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { CardContent } from "@/components/ui/card";
import { AuthCard } from "@/components/shadcn/auth/auth-card";
import { LoginForm } from "@/components/shadcn/auth/login-form";

import { loginSchema, type LoginInput } from "@/lib/validations/auth";
import { mapAuthError } from "@/lib/auth-errors";
import { useSignIn } from "@/hooks/useAuthMutations";
import { usePostLoginRedirect } from "@/auth/usePostLoginRedirect";
import { readFromState, readNoticeState } from "@/auth/read-from-state";

/**
 * Tela de login por e-mail/senha. Ao sucesso, decide o destino com
 * `usePostLoginRedirect` a partir da sessão (ADR-08): flag de troca de senha
 * primeiro, depois `/internal-admin/empresas` para `super_admin`, e `state.from` só para
 * papéis de tenant. Erro de credencial vira um alerta pt-BR genérico no topo,
 * sem revelar qual campo falhou (anti-enumeração).
 *
 * `state.notice` mostra o aviso neutro de quem chega empurrado por outra tela
 * (ADR-03: "Conta criada. Entre com seu e-mail e senha."). É feedback, não erro
 * — por isso `role="status"`.
 *
 * A apresentação vive em `LoginForm` (padrão Atlas/shadcn); aqui ficam apenas
 * a costura com a mutation, o redirect, o notice e o erro mapeado.
 */
export function LoginPage() {
  const signIn = useSignIn();
  const redirectAfterLogin = usePostLoginRedirect();
  const location = useLocation();
  const [serverError, setServerError] = useState<string | null>(null);
  const alertRef = useRef<HTMLParagraphElement>(null);
  const notice = readNoticeState(location.state);

  const form = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  useEffect(() => {
    if (serverError) alertRef.current?.focus();
  }, [serverError]);

  async function onSubmit(values: LoginInput) {
    setServerError(null);
    try {
      const { session } = await signIn.mutateAsync(values);
      redirectAfterLogin(session, readFromState(location.state));
    } catch (error) {
      setServerError(mapAuthError(error));
    }
  }

  return (
    <AuthCard>
      <CardContent className="p-6 sm:p-8">
        <LoginForm
          form={form}
          onSubmit={onSubmit}
          isPending={signIn.isPending}
          notice={notice}
          error={serverError}
          errorRef={alertRef}
        />
      </CardContent>
    </AuthCard>
  );
}
