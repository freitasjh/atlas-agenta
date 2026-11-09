import { Outlet } from "react-router-dom";

import { Logo } from "@/components/Logo";

/**
 * Shell bloqueado da área interna (ux-designer, vinculante): sem navegação de
 * tenant, sem dado operacional. Só o logo + o conteúdo da etapa (login, MFA ou
 * enroll). Rota isolada: nunca monta `AppLayout`/`AdminLayout`.
 */
export function InternalAdminLayout() {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="flex items-center justify-center border-b px-4 py-3 sm:justify-start sm:px-6">
        <Logo />
        <span className="sr-only">Área interna</span>
      </header>
      <main className="flex flex-1 items-center justify-center px-4 py-8 sm:px-6">
        <div className="w-full max-w-md">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
