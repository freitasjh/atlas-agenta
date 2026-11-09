# TASKS — internal-admin-migracao-telas (TDD, revisado PM)

## BE-01 Helper operador (P0)
- [ ] Teste pgTAP: operador ativo true; anon/authenticated false; `REVOKE`/`GRANT authenticated`/`SECURITY DEFINER`/`search_path` catálogo.
- [ ] Implementar `is_active_internal_operator()` + grants.

## BE-02 Edges 02a (P0)
- [ ] Teste Deno: operador+AAL2 passa; sem AAL2 nega; não-operador nega; must_change bloqueia; convites exigem body tenant_id; log ator/alvo sem PII.
- [ ] Implementar verifyInternalOperator em admin-subscription + invite-* (service_role, ignora profiles.role).

## BE-03 RPCs 02b lista fechada (P0)
- [ ] Teste pgTAP por RPC (12 listadas): operador vê; anon/tenant negam; RLS tenant inalterada (catálogo); regressão valores. Proibido `super_admin` ao operador.
- [ ] Implementar `OR is_active_internal_operator()` nas 12 RPCs.

## BE-04 Auditoria + métrica (P0)
- [ ] Teste: Edge write append-only (update/delete negados); `voided_at` em correção; denies contam em `internal_admin_denies_total`.
- [ ] Implementar Edge auditoria + métrica.

## FE-01 Shell + rotas (P0)
- [ ] Teste: 8 rotas sob RequireInternalOperator; índice → redirect empresas (InternalHomePage = redirect, não placeholder); login/mfa/enroll intactos max-w-md; shell `grid-cols-[16rem_1fr]`, 6 links + Sair, `aria-label`, foco h1, skip-link, `mfa_required` → /mfa; CTA ≥44px.
- [ ] Implementar InternalShell + rotas + redirect índice.

## FE-02 Empresas + TenantPlano (P0)
- [ ] Teste: paridade texto/estado <1% diff; dialogs funcionam; back-link /internal-admin/empresas; 375px cards sem scroll-x; dual-mount QA legado read-only.
- [ ] git mv + ajustar imports/links + testes movidos.

## FE-03 Assinaturas + Métricas + resto (P0)
- [ ] Teste: paridade KPIs/filtros/gráfico/tabela (null→"—"); convites dialog + tenant_id body; auditoria actor/ação/alvo/data; dashboard KPIs reais; telemetria cards; Console 0.
- [ ] git mv + testes movidos.

## FE-04 Redirect + delete legado (P0)
- [ ] Teste: Navigate /admin/* → /internal-admin/* (fase 1); fase 2: 410 + zero imports AdminLayout/Sidebar + grep `/admin` limpo (só redirect histórico) + `useAdminTenants.test`/`passwordGate.test`/`resolvePostLoginDestination.test`/`plan-telemetry-parity.test` verdes + login sem loop + docs atualizados.
- [ ] Implementar redirect + deletar bloco/router/guards órfãos + atualizar testes/docs.

## VAL-01 Harness (P0)
- Mapa redirect (8 pares): /admin → /internal-admin; /admin/empresas → /internal-admin/empresas; /admin/tenants/:id/plano → /internal-admin/tenants/:id/plano; /admin/assinaturas → /internal-admin/assinaturas; /admin/metricas → /internal-admin/metricas; /admin/dashboard → /internal-admin/dashboard; /admin/convites → /internal-admin/convites; /admin/auditoria → /internal-admin/auditoria.
- BOLA 3 sentidos: (1) JWT tenant → /internal-admin/* = 403; (2) operador sem AAL2 → nega; (3) RLS tenant inalterada (catálogo). Negação 401/403 única anti-enumeração (sem distinguir motivo no corpo).
- [ ] pgTAP + Deno + vitest + typecheck/build 0 + Chrome paridade + Console 0 + Rede 0 4xx/5xx + 1280/375 + BOLA 3 sentidos + denies_total + redirect map + EXPLAIN + grep + i18n + screenshots.

## Decisão A1 (review loop 1, registrada p/ done)
- Opção (b) aceita: reads diretos (`useAdminTenants/useAdminTenant`) seguem RLS legada; invariante "todo operador tem `profiles.super_admin`" garantida em código (bootstrap cria os dois juntos — commit `71058c5`, teste ja_existe/criado) + documentada no comentário do hook (A3). Nova RPC `admin_list/get_tenant` fica como follow-up F1 (só se surgir operador sem profile). Motivo: (a) expandiria a lista fechada 02b; RLS tenant segue NO TOUCH.
