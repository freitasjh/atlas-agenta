import {
  createBrowserRouter,
  Navigate,
  type RouterProviderProps,
} from "react-router-dom";

import { RootLayout } from "@/components/RootLayout";
import { NotFound } from "@/components/NotFound";

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
import { ClientesPage } from "@/app/clientes/ClientesPage";
import { ConfigHubPage } from "@/app/config/ConfigHubPage";
import { RelatoriosHubPage } from "@/app/relatorios/RelatoriosHubPage";
import { ComissoesPage } from "@/app/relatorios/ComissoesPage";
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

import { AdminLayout } from "@/admin/AdminLayout";
import { AdminDashboardPage, EmpresasPage } from "@/admin/pages";

/**
 * Casca de roteamento (data router). A raiz monta providers + skip-link +
 * Toaster; cada área tem seu layout.
 *
 * Ordem dos guards nas árvores privadas (ADR-11): sessão → troca de senha
 * obrigatória → papel (`/admin`) ou assinatura (`/app`) → layout. A troca vem
 * antes do papel para quem tem a flag não ver tela de acesso negado de outra
 * área. `/trocar-senha` fica fora do guard de troca (é ela que limpa a flag).
 * `/admin` índice redireciona para `/admin/empresas`; o placeholder
 * `AdminDashboardPage` permanece no código, sem rota (P-13). Rota curinga →
 * 404 em pt-BR.
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
                      { path: "clientes", element: <ClientesPage /> },
                      { path: "cobrancas", element: <CobrancasPage /> },
                      {
                        path: "config",
                        children: [
                          { index: true, element: <ConfigHubPage /> },
                          { path: "servicos", element: <ServicosPage /> },
                          { path: "combos", element: <CombosPage /> },
                          {
                            path: "profissionais",
                            children: [
                              { index: true, element: <ProfissionaisPage /> },
                              {
                                path: ":profissionalId/horarios",
                                element: <HorariosPage />,
                              },
                            ],
                          },
                          { path: "whatsapp", element: <WhatsAppPage /> },
                          {
                            path: "mensagens",
                            element: <TemplatesMensagemPage />,
                          },
                        ],
                      },
                      {
                        path: "relatorios",
                        children: [
                          { index: true, element: <RelatoriosHubPage /> },
                          { path: "comissoes", element: <ComissoesPage /> },
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
      // Admin (super admin). Ordem: RequireAuth → RequirePasswordChange →
      // RequireRole(["super_admin"]) → layout (ADR-11).
      {
        path: "admin",
        element: <RequireAuth />,
        children: [
          {
            element: <RequirePasswordChange />,
            children: [
              {
                element: <RequireRole roles={["super_admin"]} />,
                children: [
                  {
                    element: <AdminLayout />,
                    children: [
                      // Placeholder sem rota: nenhum caminho leva ao
                      // `AdminDashboardPage` (P-13). O índice do painel é a
                      // lista de empresas.
                      {
                        index: true,
                        element: <Navigate to="/admin/empresas" replace />,
                      },
                      { path: "empresas", element: <EmpresasPage /> },
                      { path: "dashboard", element: <AdminDashboardPage /> },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
      // Curinga → 404 pt-BR
      { path: "*", element: <NotFound /> },
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
