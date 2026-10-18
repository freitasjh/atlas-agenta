import { createBrowserRouter } from "react-router-dom";

import { RootLayout } from "@/components/RootLayout";
import { NotFound } from "@/components/NotFound";

import { MarketingLayout } from "@/marketing/MarketingLayout";
import { LandingPage, PrecosPage, TermosPage } from "@/marketing/pages";

import { AuthLayout } from "@/auth/AuthLayout";
import {
  CadastroPage,
  LoginPage,
  RecuperarSenhaPage,
  RedefinirSenhaPage,
} from "@/auth/pages";

import { AppLayout } from "@/app/AppLayout";
import {
  AgendaPage,
  ClientesPage,
  CobrancasPage,
  DashboardPage,
  QuitacaoPage,
} from "@/app/pages";
import { ConfigHubPage } from "@/app/config/ConfigHubPage";
import { ServicosPage } from "@/app/config/servicos/ServicosPage";
import { RequireAuth } from "@/app/guards/RequireAuth";
import { RequireRole } from "@/app/guards/RequireRole";
import { RequireActiveSubscription } from "@/app/guards/RequireActiveSubscription";

import { AdminLayout } from "@/admin/AdminLayout";
import { AdminDashboardPage, EmpresasPage } from "@/admin/pages";

/**
 * Casca de roteamento (data router). A raiz monta providers + skip-link +
 * Toaster; cada área tem seu layout. Guards de `/app` e `/admin` são stubs
 * passthrough nomeados (ADR-04). Rota curinga → 404 em pt-BR.
 */
export const router = createBrowserRouter([
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
      // App do tenant (autenticado — guards são stubs nesta fase)
      {
        path: "app",
        element: <RequireAuth />,
        children: [
          // Quitação fica FORA do guard de assinatura (irmã do bloco operacional)
          // para o redirect de `bloqueado` não voltar ao guard e entrar em loop.
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
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
      // Admin (super admin — guards são stubs nesta fase)
      {
        path: "admin",
        element: <RequireAuth />,
        children: [
          {
            element: <RequireRole roles={["super_admin"]} />,
            children: [
              {
                element: <AdminLayout />,
                children: [
                  { index: true, element: <AdminDashboardPage /> },
                  { path: "empresas", element: <EmpresasPage /> },
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
]);
