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
import { ListaEsperaPage } from "@/app/lista-espera/ListaEsperaPage";
import { CampanhasPage } from "@/app/campanhas/CampanhasPage";
import { PagamentosPage } from "@/app/config/pagamentos/PagamentosPage";
import { ClientesPage } from "@/app/clientes/ClientesPage";
import { ConfigHubPage } from "@/app/config/ConfigHubPage";
import { AuditoriaTenantPage } from "@/app/config/auditoria/AuditoriaTenantPage";
import { MembrosPage } from "@/app/config/membros/MembrosPage";
import { UsuariosPage } from "@/app/config/usuarios/UsuariosPage";
import { RelatoriosHubPage } from "@/app/relatorios/RelatoriosHubPage";
import { ComissoesPage } from "@/app/relatorios/ComissoesPage";
import { FinanceiroPage } from "@/app/relatorios/FinanceiroPage";
import { RetencaoPage } from "@/app/relatorios/RetencaoPage";
import { UtilizacaoPage } from "@/app/relatorios/UtilizacaoPage";
import { TicketPage } from "@/app/relatorios/TicketPage";
import { PdvPage } from "@/app/pdv/PdvPage";
import { FidelidadePage } from "@/app/fidelidade/FidelidadePage";
import { FinanceiroHubPage } from "@/app/financeiro/FinanceiroHubPage";
import { AssinaturasPage as AssinaturasTenantPage } from "@/app/financeiro/assinaturas/AssinaturasPage";
import { NfcePage } from "@/app/financeiro/nfce/NfcePage";
import { PagarPage } from "@/app/financeiro/pagar/PagarPage";
import { ReceberPage } from "@/app/financeiro/receber/ReceberPage";
import { ConciliacaoPage } from "@/app/financeiro/conciliacao/ConciliacaoPage";
import { DrePage } from "@/app/financeiro/dre/DrePage";
import { ExportarPage } from "@/app/financeiro/exportar/ExportarPage";
import { ServicosPage } from "@/app/config/servicos/ServicosPage";
import { RecursosPage } from "@/app/config/recursos/RecursosPage";
import { ProdutosPage } from "@/app/estoque/ProdutosPage";
import { EstoquePage } from "@/app/estoque/EstoquePage";
import { CombosPage } from "@/app/config/combos/CombosPage";
import { PacotesPage } from "@/app/config/pacotes/PacotesPage";
import { ProfissionaisPage } from "@/app/config/profissionais/ProfissionaisPage";
import { HorariosPage } from "@/app/config/profissionais/horarios/HorariosPage";
import { WhatsAppPage } from "@/app/config/whatsapp/WhatsAppPage";
import { TemplatesMensagemPage } from "@/app/config/mensagens/TemplatesMensagemPage";
import { PlanoPage } from "@/app/config/plano/PlanoPage";
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
      // Landing (público): navbar/footer próprios do template — fora do
      // MarketingLayout para não duplicar cabeçalho/rodapé.
      { index: true, element: <LandingPage /> },
      // Demais páginas de marketing continuam na casca enxuta.
      {
        element: <MarketingLayout />,
        children: [
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
                      {
                        path: "lista-espera",
                        element: (
                          <RequireRole roles={["admin", "receptionist"]}>
                            <ListaEsperaPage />
                          </RequireRole>
                        ),
                      },
                      {
                        path: "campanhas",
                        element: (
                          <RequireRole roles={["admin"]}>
                            <CampanhasPage />
                          </RequireRole>
                        ),
                      },
                      {
                        path: "fidelidade",
                        element: (
                          <RequireRole roles={["admin"]}>
                            <FidelidadePage />
                          </RequireRole>
                        ),
                      },
                      { path: "pdv", element: <PdvPage /> },
                      { path: "clientes", element: <ClientesPage /> },
                      { path: "cobrancas", element: <RequireRole roles={["admin"]}><CobrancasPage /></RequireRole> },
                      // Hub do Financeiro (Fase 5 ADR-01): skeleton gated por
                      // entitlement dentro da página, sem tabelas nem requests
                      // fase-5. Telas A–H chegam nos ADRs seguintes.
                      { path: "financeiro", element: <RequireRole roles={["admin"]}><FinanceiroHubPage /></RequireRole> },
                      // NFCe (Fase 5 ADR-03): admin-only; gating `nfce` dentro da
                      // página (upsell + zero request quando desligado).
                      { path: "financeiro/nfce", element: <RequireRole roles={["admin"]}><NfcePage /></RequireRole> },
                      // Assinaturas (Fase 5 ADR-05): admin-only; gating `recorrencia`
                      // dentro da página (upsell + zero request quando desligado).
                      { path: "financeiro/assinaturas", element: <RequireRole roles={["admin"]}><AssinaturasTenantPage /></RequireRole> },
                      // Contas a pagar (Fase 5 ADR-06): admin-only; gating `contasPagar`
                      // dentro da página (upsell + zero request quando desligado).
                      { path: "financeiro/pagar", element: <RequireRole roles={["admin"]}><PagarPage /></RequireRole> },
                      // Contas a receber (Fase 5 ADR-07): admin-only; sem entitlement
                      // novo — gating pela base `payments` do segmento dentro da página.
                      { path: "financeiro/receber", element: <RequireRole roles={["admin"]}><ReceberPage /></RequireRole> },
                      // Conciliação (Fase 5 ADR-08): admin-only; gating `conciliacao`
                      // dentro da página (upsell + zero request quando desligado).
                      { path: "financeiro/conciliacao", element: <RequireRole roles={["admin"]}><ConciliacaoPage /></RequireRole> },
                      // DRE + fluxo (Fase 5 ADR-09): admin-only; gating `dreFluxo`
                      // dentro da página (upsell + zero request quando desligado).
                      { path: "financeiro/dre", element: <RequireRole roles={["admin"]}><DrePage /></RequireRole> },
                      // Export contábil (Fase 5 ADR-10): admin-only; gating
                      // `exportContabil` dentro da página (upsell + zero request).
                      { path: "financeiro/exportar", element: <RequireRole roles={["admin"]}><ExportarPage /></RequireRole> },
                      {
                        path: "config",
                        children: [
                          { index: true, element: <RequireRole roles={["admin"]}><ConfigHubPage /></RequireRole> },
                          { path: "servicos", element: <RequireRole roles={["admin"]}><ServicosPage /></RequireRole> },
{ path: "recursos", element: <RequireRole roles={["admin"]}><RecursosPage /></RequireRole> },
                          { path: "produtos", element: <RequireRole roles={["admin"]}><ProdutosPage /></RequireRole> },
                          { path: "estoque", element: <RequireRole roles={["admin", "receptionist"]}><EstoquePage /></RequireRole> },
                          { path: "combos", element: <RequireRole roles={["admin"]}><CombosPage /></RequireRole> },
                          { path: "pacotes", element: <RequireRole roles={["admin"]}><PacotesPage /></RequireRole> },
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
                          { path: "whatsapp", element: <RequireRole roles={["admin", "receptionist", "professional"]}><WhatsAppPage /></RequireRole> },
                          { path: "pagamentos", element: <RequireRole roles={["admin"]}><PagamentosPage /></RequireRole> },
                          // Destino do CTA de gating (ADR-07): leitura, sem checkout.
                          // Fatura + checkout self-service são admin-only (RF-38):
                          // espelha `cobrancas`/`pagamentos` no guard da rota e no
                          // gate interno da página (defesa em profundidade).
                          { path: "plano", element: <RequireRole roles={["admin"]}><PlanoPage /></RequireRole> },
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
                          { path: "retencao", element: <RetencaoPage /> },
                          { path: "utilizacao", element: <UtilizacaoPage /> },
                          { path: "ticket", element: <TicketPage /> },
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
