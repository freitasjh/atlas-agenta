import { AuthShell } from "@/components/shadcn/auth/auth-shell";

/**
 * Casca da tela de troca de senha obrigatória (ADR-10).
 *
 * Continua sob `RequireAuth` e fora do guard de troca (ADR-11), mas agora
 * comparte o mesmo shell visual das demais telas de autenticação: grid
 * `min-h-svh`, marca + `ModeToggle` e capa temática em telas largas. Sem menu —
 * quem está aqui ainda não pode navegar no painel.
 */
export function GateLayout() {
  return <AuthShell />;
}
