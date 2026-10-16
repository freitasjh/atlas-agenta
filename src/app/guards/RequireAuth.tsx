import { Outlet } from "react-router-dom";

/**
 * Stub de guard de autenticação (passthrough).
 *
 * Contrato futuro (fase de auth): sem sessão Supabase → `redirect('/login')`.
 * Hoje renderiza direto o `<Outlet/>` — nenhuma lógica de auth, nenhuma
 * leitura de sessão. A forma existe para que a fase de auth preencha a lógica
 * sem reorganizar a árvore de rotas.
 */
export function RequireAuth() {
  // TODO(auth): sem sessão Supabase, redirecionar para /login.
  return <Outlet />;
}
