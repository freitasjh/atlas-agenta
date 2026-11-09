import {
  createBrowserRouter,
  type RouterProviderProps,
} from "react-router-dom";

import { RootLayout } from "@/components/RootLayout";
import { NotFound } from "@/components/NotFound";
import { AcceptInvitationPage } from "@/app/accept-invitation/AcceptInvitationPage";

import { MarketingLayout } from "@/marketing/MarketingLayout";
import { LandingPage, PrecosPage, TermosPage } from "@/marketing/pages";

import { AuthLayout } from "@/auth/AuthLayout";
import { GateLayout } from "@/auth/GateLayout";
import {
  CadastroPage,
  LoginPage,
  RecuperarSenhaPage,
  RedefinirSenhaPage,
  TrocarSenhaPage,
} from "@/auth/pages";

import { AppLayout } from "@/app/AppLayout";
import { CobrancasPage, DashboardPage, QuitacaoPage } from "@/app/pages";
import { AgendaPage } from "@/app/agenda/AgendaPage";
import { PagamentosPage } from "@/app/config/pagamentos/PagamentosPage";
import { ClientesPage } from "@/app/clientes/ClientesPage";
import { ConfigHubPage } from "@/app/config/ConfigHubPage";
import { AuditoriaTenantPage } from "@/app/config/auditoria/AuditoriaTenantPage";
import { MembrosPage } from "@/app/config/membros/MembrosPage";
import { UsuariosPage } from "@/app/config/usuarios/UsuariosPage";
import { RelatoriosHubPage } from "@/app/relatorios/RelatoriosHubPage";
import { ComissoesPage } from "@/app/relatorios/ComissoesPage";
import { FinanceiroPage } from "@/app/relatorios/FinanceiroPage";
import { PdvPage } from "@/app/pdv/PdvPage";
import { ServicosPage } from "@/app/config/servicos/ServicosPage";
import { CombosPage } from "@/app/config/combos/CombosPage";
import { ProfissionaisPage } from "@/app/config/profissionais/ProfissionaisPage";
import { HorariosPage } from "@/app/config/profissionais/horarios/HorariosPage";
import { WhatsAppPage } from "@/app/config/whatsapp/WhatsAppPage";
import { TemplatesMensagemPage } from "@/app/config/mensagens/TemplatesMensagemPage";
import { RequireAuth } from "@/app/guards/RequireAuth";
import { RequirePasswordChange } from "@/app/guards/RequirePasswordChange";
import { RequireRole } from "@/app/guards/RequireRole";
import { RequireActiveSubscription } from "@/app/guards/RequireActiveSubscription";

import { InternalAdminLayout } from "@/internal-admin/InternalAdminLayout";
import { InternalShell } from "@/internal-admin/InternalShell";
import { RequireInternalOperator } from "@/internal-admin/RequireInternalOperator";
import {
  LegacyAdminRedirect,
  LegacyTenantPlanoRedirect,
} from "@/internal-admin/LegacyAdminRedirect";
import { InternalLoginPage } from "@/internal-admin/pages/InternalLoginPage";
import { InternalMfaPage } from "@/internal-admin/pages/InternalMfaPage";
import { InternalEnrollPage } from "@/internal-admin/pages/InternalEnrollPage";
import { InternalHomePage } from "@/internal-admin/pages/InternalHomePage";
import { EmpresasPage } from "@/internal-admin/empresas/EmpresasPage";
import { TenantPlanoPage } from "@/internal-admin/tenants/TenantPlanoPage";
import { AdminDashboardPage } from "@/internal-admin/dashboard/AdminDashboardPage";
import { MetricasPage } from "@/internal-admin/metricas/MetricasPage";
import { ConvitesPage } from "@/internal-admin/convites/ConvitesPage";
import { AuditoriaPage } from "@/internal-admin/auditoria/AuditoriaPage";
import { AssinaturasPage } from "@/internal-admin/assinaturas/AssinaturasPage";
import { AgendarPage } from "@/public/AgendarPage";

/**
 * Casca de roteamento (data router). A raiz monta providers + skip-link +
 * Toaster; cada área tem seu layout.
 *
 * Ordem dos guards nas árvores privadas (ADR-11): sessão → troca de senha
 * obrigatória → assinatura (`/app`) → layout. A troca vem antes do papel
 * para quem tem a flag não ver tela de acesso negado de outra área.
 * `/trocar-senha` fica fora do guard de troca (é ela que limpa a flag).
 * `/admin/*` legado redireciona para `/internal-admin/*` (release 1,
 * VAL-01); `/internal-admin` índice redireciona para
 * `/internal-admin/empresas`. Rota curinga → 404 em pt-BR.
 */
// Anotação explícita de tipo: evita TS2742 (o tipo inferido referenciava o
// caminho interno de resolução de @remix-run/router, não portável).
export const router: RouterProviderProps["router"] = createBrowserRouter([
  {
    element: <RootLayout />,
    children: [
      // Marketing (público)
      {
        element: <MarketingLayout />,
        children: [
          { index: true, element: <LandingPage /> },
          { path: "precos", element: <PrecosPage /> },
          { path: "termos", element: <TermosPage /> },
        ],
      },
      // Autoagendamento público (ADR-19) - sem guard
      { path: "agendar/:token", element: <AgendarPage /> },
      { path: "accept-invitation", element: <AcceptInvitationPage /> },
      // Auth (público)
      {
        element: <AuthLayout />,
        children: [
          { path: "login", element: <LoginPage /> },
          { path: "cadastro", element: <CadastroPage /> },
          { path: "recuperar-senha", element: <RecuperarSenhaPage /> },
          { path: "redefinir-senha", element: <RedefinirSenhaPage /> },
        ],
      },

      // Troca de senha obrigatória (ADR-10). Exige sessão (`RequireAuth`), mas
      // fica FORA do guard de troca (ADR-11): incluir o guard aqui criaria
      // laço, porque é esta tela que limpa a flag.
      {
        path: "trocar-senha",
        element: <RequireAuth />,
        children: [
          {
            element: <GateLayout />,
            children: [{ index: true, element: <TrocarSenhaPage /> }],
          },
        ],
      },
      // App do tenant (autenticado). Ordem: RequireAuth → RequirePasswordChange
      // → RequireActiveSubscription → layout (ADR-11).
      {
        path: "app",
        element: <RequireAuth />,
        children: [
          {
            element: <RequirePasswordChange />,
            children: [
              // Quitação fica FORA do guard de assinatura (irmã do bloco
              // operacional) para o redirect de `bloqueado` não voltar ao guard
              // e entrar em loop.
              { path: "quitacao", element: <QuitacaoPage /> },
              {
                element: <RequireActiveSubscription />,
                children: [
                  {
                    element: <AppLayout />,
                    children: [
                      { index: true, element: <DashboardPage /> },
                      { path: "agenda", element: <AgendaPage /> },
                      { path: "pdv", element: <PdvPage /> },
                      { path: "clientes", element: <ClientesPage /> },
                      { path: "cobrancas", element: <RequireRole roles={["admin"]}><CobrancasPage /></RequireRole> },
                      {
                        path: "config",
                        children: [
                          { index: true, element: <RequireRole roles={["admin"]}><ConfigHubPage /></RequireRole> },
                          { path: "servicos", element: <RequireRole roles={["admin"]}><ServicosPage /></RequireRole> },
                          { path: "combos", element: <RequireRole roles={["admin"]}><CombosPage /></RequireRole> },
                          {
                            path: "profissionais",
                            children: [
                              { index: true, element: <RequireRole roles={["admin"]}><ProfissionaisPage /></RequireRole> },
                              {
                                path: ":profissionalId/horarios",
                                element: (
                                  <RequireRole roles={["admin", "professional", "receptionist"]}>
                                    <HorariosPage />
                                  </RequireRole>
                                ),
                              },
                            ],
                          },
                          { path: "whatsapp", element: <RequireRole roles={["admin"]}><WhatsAppPage /></RequireRole> },
                          { path: "pagamentos", element: <RequireRole roles={["admin"]}><PagamentosPage /></RequireRole> },
                          {
                            path: "mensagens",
                            element: <RequireRole roles={["admin"]}><TemplatesMensagemPage /></RequireRole>,
                          },
                          { path: "membros", element: <RequireRole roles={["admin"]}><MembrosPage /></RequireRole> },
                          { path: "usuarios", element: <RequireRole roles={["admin"]}><UsuariosPage /></RequireRole> },
                          { path: "auditoria", element: <RequireRole roles={["admin"]}><AuditoriaTenantPage /></RequireRole> },
                        ],
                      },
                      {
                        path: "relatorios",
                        element: <RequireRole roles={["admin"]} />,
                        children: [
                          { index: true, element: <RelatoriosHubPage /> },
                          { path: "comissoes", element: <ComissoesPage /> },
                          { path: "financeiro", element: <FinanceiroPage /> },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
      // Legado `/admin` (release 1, VAL-01): só redirect para
      // `/internal-admin/*`, sem guards próprios (o destino guarda).
      {
        path: "admin",
        children: [
          {
            index: true,
            element: <LegacyAdminRedirect to="/internal-admin" />,
          },
          { path: "empresas", element: <LegacyAdminRedirect to="/internal-admin/empresas" /> },
          { path: "tenants/:id/plano", element: <LegacyTenantPlanoRedirect /> },
          { path: "dashboard", element: <LegacyAdminRedirect to="/internal-admin/dashboard" /> },
          { path: "metricas", element: <LegacyAdminRedirect to="/internal-admin/metricas" /> },
          { path: "convites", element: <LegacyAdminRedirect to="/internal-admin/convites" /> },
          { path: "auditoria", element: <LegacyAdminRedirect to="/internal-admin/auditoria" /> },
          { path: "assinaturas", element: <LegacyAdminRedirect to="/internal-admin/assinaturas" /> },
          { path: "*", element: <LegacyAdminRedirect to="/internal-admin" /> },
        ],
      },
      // Curinga → 404 pt-BR
      { path: "*", element: <NotFound /> },
      // Área interna isolada (internal-operators-mfa): sem RequireRole/tenant.
      // Prova única via RequireInternalOperator (Edge verify-operator, AAL2 por
      // request). Login/MFA/enroll fora do guard, sob o layout estreito
      // (max-w-md); o núcleo exige operador+AAL2 sob o InternalShell.
      {
        path: "internal-admin",
        children: [
          {
            element: <InternalAdminLayout />,
            children: [
              { path: "login", element: <InternalLoginPage /> },
              { path: "mfa", element: <InternalMfaPage /> },
              { path: "enroll", element: <InternalEnrollPage /> },
            ],
          },
          {
            element: <RequireInternalOperator />,
            children: [
              {
                element: <InternalShell />,
                children: [
                  { index: true, element: <InternalHomePage /> },
                  { path: "empresas", element: <EmpresasPage /> },
                  { path: "tenants/:id/plano", element: <TenantPlanoPage /> },
                  { path: "dashboard", element: <AdminDashboardPage /> },
                  { path: "metricas", element: <MetricasPage /> },
                  { path: "convites", element: <ConvitesPage /> },
                  { path: "auditoria", element: <AuditoriaPage /> },
                  { path: "assinaturas", element: <AssinaturasPage /> },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
], {
  // Flags do React Router 7 ativadas já no 6 (ADR-14): sem isto cada carga
  // emite 5 avisos de deprecação. `v7_startTransition` fica no `RouterProvider`
  // (main.tsx) — é o único que pertence a ele.
  future: {
    v7_fetcherPersist: true,
    v7_normalizeFormMethod: true,
    v7_partialHydration: true,
    v7_relativeSplatPath: true,
    v7_skipActionErrorRevalidation: true,
  },
});
