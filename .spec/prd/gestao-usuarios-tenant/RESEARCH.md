# RESEARCH — Gestão de Usuários do Tenant + Visual por Papel (MVP)

> **prd-id**: `gestao-usuarios-tenant`
> **Escopo MVP**: RF-01, RF-02, RF-03, RF-04, RF-06, RF-07; RNF-01, RNF-02, RNF-05, RNF-09.
> **Fontes de verdade**: relatório de planejamento `~/.opencode/plan/relatorio-gestao-usuarios-atlas-agenda.md` (2026-11-03) + `PRD.md` (draft).
> **Contrato**: `.agents/rules/prd-adr-pipeline.md` §1 — cada decisão chave com ≥2 alternativas, fonte (http), trade-off e 1 recomendação.
> **Data de acesso das fontes web**: 2026-11-04 (ISO-8601). Fontes locais do repo citadas como `local:`.

---

## 0. Metodologia e fontes

Busca híbrida (brain MCP + web). Busca-antes: `brain_search` em `arquitetura/projetos/atlas-agenda` retornou notas relevantes sobre privilégios de `profiles` (grant de coluna + RLS + trigger), impacto arquitetural desta iniciativa e padrão de duas populações (Atlas vs empresa). As decisões abaixo reusam essas decisões já tomadas (grant + RLS + trigger) e não as reabrem.

Fontes externas consultadas (acesso 2026-11-04):
- Clerk — "Role-Based Access Control (RBAC) for B2B SaaS" Part 1 & 2 — https://clerk.com/articles/role-based-access-control-rbac-for-b2b-saas
- WorkOS — "Customer and user onboarding for real-world B2B SaaS" — https://workos.com/blog/b2b-saas-onboarding-organizations-users
- LoginRadius — "Access Control SaaS for B2B & Multi-Tenant" — https://www.loginradius.com/blog/engineering/rbac-saas-multi-tenant-b2b-platforms
- Logto — "Implement user collaboration within a multi-tenant app" — https://blog.logto.io/implement-user-collaboration-in-your-app
- NIST SP 800-53 (AC-3/AC-6); OWASP Authorization Cheat Sheet.
- Supabase — "Custom Access Token Hook" — https://supabase.com/docs/guides/auth/auth-hooks/custom-access-token-hook
- Supabase — "Signing out" — https://supabase.com/docs/guides/auth/signout
- Supabase — "Managing User Data" (profiles trigger) — https://supabase.com/docs/guides/auth/managing-user-data
- Supabase — "Column Level Security" — https://supabase.com/docs/guides/database/postgres/column-level-security
- Supabase — "Row Level Security" — https://supabase.com/docs/guides/database/postgres/row-level-security
- Nielsen Norman Group — "Tabs, Used Right" — https://www.nngroup.com/articles/tabs-used-right/
- Eleken — "Tabs UX Best Practices" — https://www.eleken.co/blog-posts/tabs-ux

Fontes locais do repo:
- `local:` `.agents/rules/seguranca-multitenant.md`, `.agents/rules/dominio.md`, `.agents/rules/produto.md`, `.agents/rules/convencoes-codigo.md`, `.agents/rules/stack.md`
- `local:` brain `arquitetura/projetos/atlas-agenda/impacto-gestao-usuarios-visual-por-papel`, `profiles-privilegios-colunas`, `profiles-trigger-barreira-role-tenant`, `profiles-role-tenant-ninguem-troca-pelo-cliente`, `seguranca-duas-camadas-grant-policy`
- `local:` migrations `supabase/migrations/20250216091000_profiles_and_helpers.sql`, `20250228090000*`, `20250303100000_invitations_audit.sql`

---

## 1. Decisão D1 — E-mail em `profiles`

**Contexto.** `profiles` hoje não armazena e-mail (só `auth.users`). A tela de Usuários (RF-01) precisa exibir o e-mail do membro. Hoje a única forma de obtê-lo é via service role (Edge Function) ou via claim no JWT. Decisão pendente no PRD §14.1 e relatório §13.1.

### Alternativas

**A) Desnormalizar `email` em `profiles` via trigger (recomendada).**
- Como: migration aditiva `profiles.email text`; trigger `handle_new_user` popula a partir de `auth.users.email`; `accept-invitation` atualiza; backfill de profiles existentes. Coluna incluída no guard de colunas privilegiadas (`profiles_guard_privileged_columns`) e no grant (apenas service role escreve; cliente não edita).
- Prós: leitura direta sob RLS (sem service role no cliente); consistente com multi-tenant (email via trigger, não parâmetro); TanStack Query cacheia normalmente; uma única query para a tabela.
- Contras: duplicação de dado; risco de drift se trigger falhar; exige backfill; coluna privilegiada a mais no guard.
- Fonte: Supabase — "Managing User Data" (trigger em `auth.users` para popular `public.profiles`) — https://supabase.com/docs/guides/auth/managing-user-data — acesso 2026-11-04. Padrão já usado no projeto (`handle_new_user`, migration `20250216091000`). Brain: `arquitetura/projetos/atlas-agenda/impacto-gestao-usuarios-visual-por-papel` §2/§7 ("E-mail em profiles desnormalizado inconsistente → trigger handle_new_user + accept-invitation + backfill; não permitir edição pelo cliente").

**B) Ler e-mail via Edge Function com service role.**
- Como: `useTenantUsers` chama Edge Function que lê `auth.users` com service role e junta com `profiles`.
- Prós: fonte única da verdade (sem drift); sem migration de coluna; sem backfill.
- Contras: toda listagem passa por Edge Function (latência + custo); quebra o padrão de leitura direta sob RLS; cliente depende de função para dado de exibição; invalidação de cache mais complexa; mais superfície de segurança (service role exposto indiretamente).
- Fonte: Supabase — "Securing Edge Functions" (service role apenas server-side) — https://supabase.com/docs/guides/functions/auth — acesso 2026-11-04. Padrão do projeto: service role só em Edge Functions, nunca no cliente (`.agents/rules/seguranca-multitenant.md`).

**C) E-mail apenas no JWT (claim).**
- Como: hook `custom_access_token` emite `email` (já é claim padrão do Supabase) e o frontend lê de `auth-claims.ts`.
- Prós: zero mudança de schema; já disponível no token.
- Contras: só o e-mail do usuário *logado*; não resolve listagem de outros membros do tenant (RF-01 exige listar todos); token stale; não escalável para admin gerenciar.
- Fonte: Supabase — "Custom Access Token Hook" (claims `email` padrão) — https://supabase.com/docs/guides/auth/auth-hooks/custom-access-token-hook — acesso 2026-11-04.

### Trade-off

| Critério | A (trigger) | B (Edge Function) | C (JWT) |
|---|---|---|---|
| Listagem de todos os membros | ✅ | ✅ | ❌ |
| Leitura direta sob RLS | ✅ | ❌ | n/a |
| Drift risk | médio (mitigado por trigger+backfill) | baixo | n/a |
| Latência/custo | baixo | alto | baixo |
| Alinhamento com padrão do projeto | ✅ (handle_new_user) | parcial | n/a |

### Recomendação
**A — desnormalizar `email` em `profiles` via trigger**, com a coluna incluída no guard de colunas privilegiadas e grant de escrita apenas via service role. Motivo: é o único que permite listagem direta sob RLS (trava real) sem expor service role, e o projeto já usa `handle_new_user`. Mitigar drift com trigger + backfill + teste de consistência. B fica como fallback se o backfill falhar em produção.

---

## 2. Decisão D2 — Desativação de usuário (bloqueio de acesso)

**Contexto.** RF-04: admin desativa (soft delete) um usuário; usuário desativado não acessa o app. Como identidade vem do JWT (claims), há latência entre `active=false` no banco e o token expirar (jwt_expiry=3600, refresh rotation ativa). Decisão pendente no PRD §14.2.

### Alternativas

**A) Revogação imediata de sessão (signOut global) + claim `active` (recomendada).**
- Como: Edge Function `deactivate-user` (service role) seta `active=false` + auditoria + chama `supabase.auth.admin.signOut(userId, 'global')` para revogar refresh tokens de todas as sessões; claim `active` no hook custom-access-token fail-closed (profile inativo → login/refresh falha). Reativação não recria sessão automaticamente (usuário re-loga).
- Prós: bloqueio imediato (revogação global) + defesa em profundidade (claim fail-closed); alinha com "mínimo privilégio"; padrão Supabase documentado.
- Contras: depende de service role (já padrão para mutações privilegiadas); revogação global derruba todas as sessões do usuário (intencional para desativação); latência do hook no refresh.
- Fonte: Supabase — "Signing out" (scope `global` revoga refresh tokens de todas as sessões) — https://supabase.com/docs/guides/auth/signout — acesso 2026-11-04. Supabase JS reference `auth.admin.signOut` — https://supabase.com/docs/reference/javascript/auth-signout — acesso 2026-11-04. Brain: `impacto-gestao-usuarios-visual-por-papel` §4 ("Token stale: Edge Function de deactivate/change-role deve revogar sessões (supabase.auth.admin.signOut scope global)").

**B) Apenas claim `active`, efeito no próximo request/refresh.**
- Como: seta `active=false`; hook fail-closed no próximo refresh; JWT atual permanece válido até expirar (até 1h).
- Prós: mais simples; sem chamada admin; menos acoplamento.
- Contras: janela de até 1h em que usuário desativado ainda acessa (inaceitável para desativação de segurança); não atende RNF-02 (mínimo privilégio) nem critério "usuário desativado não consegue usar o app".
- Fonte: Supabase — "User sessions" (access token curto, refresh token longo) — https://supabase.com/docs/guides/auth/sessions — acesso 2026-11-04.

**C) Bloqueio apenas no guard do frontend.**
- Como: `RequireAuth` checa `active` do `useCurrentUser`; se false, logout forçado.
- Prós: UX imediata; sem chamada server.
- Contras: trava de UI não é fronteira (`.agents/rules/seguranca-multitenant.md` P9, OWASP); usuário com token válido e API direta ainda acessa dados; não atende RNF-01/RNF-02.
- Fonte: OWASP Authorization Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html — acesso 2026-11-04 (citado no relatório §3).

### Trade-off

| Critério | A (revogação+claim) | B (claim só) | C (guard FE) |
|---|---|---|---|
| Bloqueio imediato | ✅ | ❌ (≤1h) | parcial (UI) |
| Trava real (server) | ✅ | ✅ (no refresh) | ❌ |
| Complexidade | média | baixa | baixa |
| Alinhamento RNF-01/02 | ✅ | parcial | ❌ |

### Recomendação
**A — revogação imediata (signOut global) + claim `active` fail-closed**, com fallback defensivo no guard frontend (C) como UX, nunca como fronteira. Motivo: única opção que fecha a janela de acesso imediatamente e mantém defesa em profundidade. Para troca de papel (RF-05, fora do MVP), usar B (efeito no próximo acesso) ou revogar se crítico — decisão adiada.

---

## 3. Decisão D3 — Vínculo profissional ↔ login

**Contexto.** RF-03: convite pode vincular `professional_id`; ao aceitar, `professionals.profile_id` é setado. Padrão de referência do brain: populações separadas (Atlas vs empresa), staff com login opcional (Zenoti/Mangomint). Relatório §3.1 P5.

### Alternativas

**A) Convite com `professional_id` pré-cadastrado (recomendada).**
- Como: admin cadastra o profissional (operacional) → clica "Convidar para acesso" → `invite-member` com `role=professional` + `professional_id` → aceite cria profile e seta `professionals.profile_id` (transação, validar tenant). Vinculação explícita, consentida.
- Prós: separação clara entre entidade operacional e identidade; admin controla quem tem acesso; auditável; alinha com P5 (staff com login opcional); evita auto-vínculo silencioso.
- Contras: exige pré-cadastro do profissional (admin precisa cadastrar antes); mais passos no onboarding.
- Fonte: relatório §3.1 P5 (Zenoti/Mangomint: staff com login opcional) — padrão de salões. WorkOS — "Customer and user onboarding for real-world B2B SaaS" (convite com papel atribuído, aceite cria profile no tenant) — https://workos.com/blog/b2b-saas-onboarding-organizations-users — acesso 2026-11-04. Brain: `arquitetura/projetos/atlas-cobranca/duas-populacoes-usuario-atlas-vs-empresa`.

**B) Auto-cadastro de `professional` no aceite do convite.**
- Como: convite `role=professional` sem `professional_id`; `accept-invitation` cria profile + professional (nome de `full_name`) no mesmo tenant.
- Prós: onboarding mais rápido (um passo); útil para profissional que se cadastra sozinho.
- Contras: profissional operacional criado sem dados completos (serviços, horários, comissão); risco de duplicata se admin já cadastrou; menos governança; fora do MVP? PRD RF-10 (P3) já prevê como "auto-cadastro" opcional futuro.
- Fonte: Logto — "Implement user collaboration within a multi-tenant app" (convite cria membership no tenant) — https://blog.logto.io/implement-user-collaboration-in-your-app — acesso 2026-11-04.

**C) Cadastro direto com senha temporária (sem convite por e-mail).**
- Como: admin cria usuário com senha temporária e entrega manualmente; profile + professional vinculados.
- Prós: sem dependência de e-mail/convite; imediato.
- Contras: senha temporária em texto (risco de segurança, viola LGPD/RNF-06); sem consentimento explícito; sem trilha de aceite; anti-padrão documentado no relatório (§3.2 "Vincular profissional a login automaticamente no cadastro operacional sem consentimento/convite").
- Fonte: OWASP Authentication Cheat Sheet (evitar senhas temporárias compartilhadas) — https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html — acesso 2026-11-04. Clerk — RBAC B2B SaaS (convite por e-mail com papel) — https://clerk.com/articles/role-based-access-control-rbac-for-b2b-saas — acesso 2026-11-04.

### Trade-off

| Critério | A (pré-cadastro) | B (auto-cadastro) | C (senha temp) |
|---|---|---|---|
| Governança/consentimento | ✅ | parcial | ❌ |
| Dados operacionais completos | ✅ | ❌ (incompleto) | ✅ |
| Risco de duplicata | baixo | alto | baixo |
| Segurança (sem senha em claro) | ✅ | ✅ | ❌ |
| Escopo MVP (RF-03) | ✅ | RF-10 (P3) | ❌ |

### Recomendação
**A — convite com `professional_id` pré-cadastrado**, como caminho principal (RF-03, P1). B fica como RF-10 (P3, desejável) para onboarding rápido quando admin optar. C descartado (anti-padrão de segurança). Motivo: governança + dados operacionais completos + consentimento, alinhado com padrão de salões e com o modelo de duas populações.

---

## 4. Decisão D4 — Visual por papel (UI)

**Contexto.** RF-06/RF-07: professional e receptionist recebem menu/rotas próprios. Hoje todos compartilham `/app` com filtro de dados. Decisão de arquitetura de UI.

### Alternativas

**A) Sidebar filtrado por capacidades + guards de rota (recomendada).**
- Como: `AppSidebar` deriva itens de `usePermissions()` (capacidades por role); `RequireRole` por rota no router; redirect com toast ao tentar URL proibida; dashboard copy por papel. Mesma base de código.
- Prós: uma única base (sem drift); capacidades já existem (`usePermissions`); testável; alinha com P6 (UI por papel via capacidades, não apps separados); manutenção simples.
- Contras: sidebar pode ficar complexo com muitas condições; risco de "esquecer" um guard em rota nova.
- Fonte: Clerk — RBAC for B2B SaaS Part 2 (UI por capacidades derivadas do role, não apps separados) — https://clerk.com/articles/role-based-access-control-rbac-for-b2b-saas-2 — acesso 2026-11-04. WorkOS — onboarding (papel define "aha moment", mas mesma base) — https://workos.com/blog/b2b-saas-onboarding-organizations-users — acesso 2026-11-04. Relatório §3.1 P6. Brain: `impacto-gestao-usuarios-visual-por-papel` §6.

**B) Rotas/layouts separados por role.**
- Como: `/app/admin/*`, `/app/professional/*`, `/app/reception/*` com layouts distintos.
- Prós: isolamento visual total; rotas auto-documentam o papel.
- Contras: duplicação de código e drift; mais rotas para manter; refatoração grande; risco de inconsistência entre layouts; contraria anti-padrão "apps/telas separadas por papel" (relatório §3.2).
- Fonte: relatório §3.2 (anti-padrão: criar apps/telas separadas por papel — duplicação de código, drift).

**C) App dedicado por papel (build separado).**
- Como: builds distintos (ex: `professional.app`).
- Prós: bundle menor por papel; deploy independente.
- Contras: overhead de build/deploy; duplicação massiva; não justificado para 4 roles; fora de escopo (produto.md: app mobile nativo dedicado = fora de escopo; web responsivo).
- Fonte: produto.md (fora de escopo MVP: app mobile nativo dedicado; usar responsivo).

### Trade-off

| Critério | A (sidebar+guards) | B (rotas separadas) | C (app dedicado) |
|---|---|---|---|
| Drift de código | baixo | alto | muito alto |
| Custo de manutenção | baixo | médio | alto |
| Isolamento visual | médio | alto | alto |
| Alinhamento com padrão do projeto | ✅ | ❌ | ❌ |
| Escopo MVP | ✅ | ❌ (refactor grande) | ❌ |

### Recomendação
**A — sidebar filtrado por capacidades + guards de rota**, mantendo uma única base. Motivo: capacidades já existem, evita drift, e a trava real é RLS (UI é defesa em profundidade). B/C descartados como anti-padrão (relatório §3.2). Mitigar risco de "esquecer guard" com checklist de rota no code review e testes de acesso por role.

---

## 5. Decisão D5 — Gestão de usuários: layout da tela

**Contexto.** RF-02: convites passam a ser aba/seção da tela de Usuários. Decisão de UX: tabs Ativos/Convites vs telas separadas vs drawer único.

### Alternativas

**A) Tela única com tabs "Ativos" e "Convites" (recomendada).**
- Como: `UsuariosPage` com duas tabs; "Ativos" (RF-01) e "Convites" (atual `MembrosPage`); aceite move convite para Ativos (invalidar query).
- Prós: fluxo único de gestão de pessoas; contexto compartilhado; menos navegação; alinha com RF-02 ("fluxo único"); tabs funcionam bem para 2 seções de igual peso.
- Contras: tela pode ficar densa; tabs mal usadas desorientam (NNG).
- Fonte: NNG — "Tabs, Used Right" (tabs para seções de igual peso, conteúdo similar, manter usuário no lugar) — https://www.nngroup.com/articles/tabs-used-right/ — acesso 2026-11-04. Eleken — "Tabs UX Best Practices" (2-6 seções em uma linha) — https://www.eleken.co/blog-posts/tabs-ux — acesso 2026-11-04. Relatório §3.1 P3 (convite + gestão em fluxo único).

**B) Telas separadas (Usuários + Convites).**
- Como: rotas `/app/config/usuarios` e `/app/config/convites`.
- Prós: cada tela focada; menos densidade.
- Contras: fragmenta gestão de pessoas; mais navegação; duplica layout/lista; contraria RF-02.
- Fonte: relatório §3.2 (evitar fragmentação); padrão atual do projeto (MembrosPage separado) é o que se quer consolidar.

**C) Drawer/modal único.**
- Como: uma tabela de usuários + modal de convite/detalhe.
- Prós: foco em lista; modal para ações.
- Contras: modal para listagem de convites perde visibilidade; difícil comparar ativos vs pendentes; não escala para histórico (RF-11 futuro); acessibilidade de modal aninhado (a11y RNF-03).
- Fonte: NNG — tabs vs modal (modal para ações pontuais, não para seções de navegação) — https://www.nngroup.com/articles/tabs-used-right/ — acesso 2026-11-04.

### Trade-off

| Critério | A (tabs) | B (separado) | C (drawer) |
|---|---|---|---|
| Fluxo único de pessoas | ✅ | ❌ | parcial |
| Densidade | média | baixa | baixa |
| Alinhamento RF-02 | ✅ | ❌ | parcial |
| Escalabilidade (histórico RF-11) | ✅ (nova tab) | ✅ | ❌ |
| Acessibilidade | ✅ | ✅ | médio |

### Recomendação
**A — tela única com tabs "Ativos" e "Convites"**, com possibilidade de adicionar tab "Histórico" (RF-11) no futuro. Motivo: fluxo único, alinhado com RF-02, e tabs são o padrão correto para 2 seções de igual peso. Mitigar densidade com paginação/virtualização (RNF-04) e estados de loading/empty/error.

---

## 6. Decisão D6 — Guard de colunas privilegiadas em `profiles`

**Contexto.** O projeto já decidiu (brain: `profiles-privilegios-colunas`, `profiles-trigger-barreira-role-tenant`, `profiles-role-tenant-ninguem-troca-pelo-cliente`) uma estratégia de duas camadas: grant de coluna (fronteira principal) + trigger BEFORE UPDATE (barreira redundante) para `role`/`tenant_id`. A nova iniciativa adiciona colunas privilegiadas (`active`, `deactivated_at/by`, `role_changed_at/by`, `email`). Decisão: estender o mesmo padrão (trigger) vs RLS WITH CHECK vs Edge Function service role.

### Alternativas

**A) Trigger BEFORE UPDATE estendido (recomendada, alinhada com decisão já tomada).**
- Como: estender `profiles_guard_privileged_columns` (ou `profiles_guard_role_tenant`) para incluir `active`, `deactivated_at`, `deactivated_by`, `role_changed_at`, `role_changed_by`, `email` na lista de colunas que `anon`/`authenticated` não podem alterar (comparar OLD vs NEW, SQLSTATE 42501). Security invoker. Complementa o grant de coluna (que já fecha a escrita para `authenticated`).
- Prós: barreira redundante contra regressão do grant; alinha com decisão já tomada (opção B do usuário); compara OLD vs NEW (a policy não consegue); mensagem fixa sem eco de valor.
- Contras: trigger pode ser bypassado por service role (intencional — mutações privilegiadas via Edge Function); manutenção da lista de colunas (CA-14).
- Fonte: brain `profiles-trigger-barreira-role-tenant` (decisão do usuário, opção B). brain `profiles-role-tenant-ninguem-troca-pelo-cliente` (trigger bloqueia qualquer role de aplicação, inclusive super_admin; exceção removida). Postgres docs — triggers BEFORE UPDATE — https://www.postgresql.org/docs/current/trigger-definition.html — acesso 2026-11-04.

**B) RLS WITH CHECK.**
- Como: policy `profiles_update_self_or_admin` com WITH CHECK impedindo mudança de colunas privilegiadas.
- Prós: nativo do Postgres; sem trigger.
- Contras: WITH CHECK enxerga só a linha nova (NEW), não OLD — não consegue detectar mudança de coluna (ex: `active` de true→false) sem comparar, o que exigiria subquery ao próprio OLD (não disponível no WITH CHECK de forma simples). O projeto já descartou essa abordagem para `role` por esse motivo (brain `profiles-privilegios-colunas`: "a policy enxerga só a linha nova, não o OLD. Ela barra promoção a super_admin, mas não rebaixamento").
- Fonte: Supabase — "Row Level Security" (policies como WHERE implícito) — https://supabase.com/docs/guides/database/postgres/row-level-security — acesso 2026-11-04. Brain `profiles-privilegios-colunas`.

**C) Edge Function com service role (sem guard no banco).**
- Como: todas as mutações de colunas privilegiadas passam por Edge Function service role; cliente não toca essas colunas.
- Prós: controle total no código; auditoria fácil; padrão já usado para `deactivate-user`/`change-user-role`.
- Contras: não é defesa em profundidade — se uma policy futura permitir UPDATE dessas colunas, não há barreira no banco; o projeto já decidiu que a trava real é grant + trigger (defesa em profundidade, `.agents/rules/seguranca-multitenant.md` P9).
- Fonte: Supabase — "Securing Edge Functions" — https://supabase.com/docs/guides/functions/auth — acesso 2026-11-04. Brain `seguranca-duas-camadas-grant-policy`.

### Trade-off

| Critério | A (trigger) | B (RLS WITH CHECK) | C (Edge Function) |
|---|---|---|---|
| Comparação OLD vs NEW | ✅ | ❌ | n/a (código) |
| Defesa em profundidade | ✅ | parcial | ❌ (só código) |
| Alinhamento com decisão já tomada | ✅ | ❌ (descartado) | parcial |
| Manutenção | média (lista CA-14) | baixa | baixa |
| Cobre mutações service role | n/a (intencional) | n/a | ✅ |

### Recomendação
**A — estender o trigger BEFORE UPDATE** para as novas colunas privilegiadas, mantendo grant de coluna como fronteira principal e Edge Functions service role como caminho de mutação (C). B descartado (não compara OLD/NEW, já decidido). Motivo: defesa em profundidade já estabelecida; o trigger é a "prova da regra" (brain). Mutação real de `active`/`role`/`email` acontece apenas via Edge Function service role (que bypassa o trigger por design — service role é o ator privilegiado auditado).

---

## 7. Decisões transversais (consolidação)

| # | Decisão | Recomendação | ADR sugerido (relatório §11) |
|---|---|---|---|
| D1 | E-mail em profiles | A — trigger desnormalizado | ADR-01 (schema) |
| D2 | Desativação de acesso | A — revogação global + claim active | ADR-02 (Edge Functions) + ADR-03 (JWT) |
| D3 | Vínculo professional↔login | A — convite com professional_id pré-cadastrado | ADR-04/05 (vínculo) |
| D4 | Visual por papel | A — sidebar por capacidades + guards | ADR-05 (frontend) |
| D5 | Layout da tela de gestão | A — tabs Ativos/Convites | ADR-03 (frontend) |
| D6 | Guard de colunas privilegiadas | A — trigger estendido | ADR-01 (schema) |

### Mapeamento para ADRs do relatório §11
1. ADR-01 Schema: `profiles.active/audit + email + invitations.professional_id + guard update (trigger estendido)` — D1, D6.
2. ADR-02 Edge Functions privilegiadas: `deactivate/reactivate/change-role/unlink + session revocation` — D2.
3. ADR-03 JWT: `claim active + hook + frontend parse/guard` — D2.
4. ADR-04 Frontend: `UsuariosPage (tabs) + useTenantUsers + sidebar por capacidade + route guards` — D4, D5.
5. ADR-05 Vínculo professional↔login via convite — D3.
6. ADR-06 Auditoria/onboarding por papel + redirect — (RF-08/11, P2/P3, fora do MVP mas preparado).

### Invariantes preservadas (não reabertas)
- 4 roles fixos (sem role explosion) — relatório P10, PRD §9.
- Soft delete (active) em vez de hard delete — P4, RNF-09.
- Trava real no RLS + service role em Edge Functions; UI é defesa em profundidade — P9, `.agents/rules/seguranca-multitenant.md`.
- Cliente nunca envia `tenant_id` como filtro — `.agents/rules/convencoes-codigo.md`, `.agents/rules/seguranca-multitenant.md`.
- Migrations aditivas; backfill `active=true` — RNF-09.
- Grant de coluna + trigger (decisão já tomada) — brain `profiles-privilegios-colunas`, `profiles-trigger-barreira-role-tenant`.

### Riscos herdados (mitigação)
- Lockout do último admin (concorrência) — mitigação: check transacional com `SELECT ... FOR UPDATE`/advisory lock na Edge Function; UI desabilita ação; teste de concorrência.
- Token stale após mudança de papel/desativação — mitigação: revogação global + claim fail-closed + aviso "efeito no próximo acesso".
- Escalation por colunas não guardadas (active/email) — mitigação: estender trigger + grant + testes SQL com sessão authenticated.
- Cross-tenant no vínculo profile↔professional — mitigação: FK composta (tenant_id, profile_id) ou validação service role; testes RLS.
- E-mail desnormalizado inconsistente — mitigação: trigger + backfill + teste de consistência.

---

## 8. Próximos passos

1. Gate humano (Product Owner) aprova este RESEARCH + PRD §16.
2. Gerar ADR-INDEX.md (ledger 1:1) e ADRs ADR-001..ADR-006 conforme §7.
3. Cada ADR segue pipeline PRD→ADR→SDD (`.agents/rules/prd-adr-pipeline.md`): 1 ADR = 1 branch = 1 PR; merge humano.
4. Persistir decisões no brain (`arquitetura/projetos/atlas-agenda/...`) após gate.

---

## 9. Fontes (consolidado)

Externa (acesso 2026-11-04):
- Clerk — RBAC for B2B SaaS (Part 1 & 2) — https://clerk.com/articles/role-based-access-control-rbac-for-b2b-saas
- WorkOS — B2B SaaS onboarding — https://workos.com/blog/b2b-saas-onboarding-organizations-users
- LoginRadius — RBAC SaaS multi-tenant — https://www.loginradius.com/blog/engineering/rbac-saas-multi-tenant-b2b-platforms
- Logto — user collaboration multi-tenant — https://blog.logto.io/implement-user-collaboration-in-your-app
- NIST SP 800-53 (AC-3/AC-6); OWASP Authorization Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html
- Supabase — Custom Access Token Hook — https://supabase.com/docs/guides/auth/auth-hooks/custom-access-token-hook
- Supabase — Signing out (global) — https://supabase.com/docs/guides/auth/signout
- Supabase — auth.admin.signOut reference — https://supabase.com/docs/reference/javascript/auth-signout
- Supabase — User sessions — https://supabase.com/docs/guides/auth/sessions
- Supabase — Managing User Data (profiles trigger) — https://supabase.com/docs/guides/auth/managing-user-data
- Supabase — Column Level Security — https://supabase.com/docs/guides/database/postgres/column-level-security
- Supabase — Row Level Security — https://supabase.com/docs/guides/database/postgres/row-level-security
- Supabase — Securing Edge Functions — https://supabase.com/docs/guides/functions/auth
- NNG — Tabs, Used Right — https://www.nngroup.com/articles/tabs-used-right/
- Eleken — Tabs UX Best Practices — https://www.eleken.co/blog-posts/tabs-ux
- PostgreSQL — trigger definition — https://www.postgresql.org/docs/current/trigger-definition.html
- OWASP Authentication Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html

Local (repo):
- `.agents/rules/seguranca-multitenant.md`, `.agents/rules/dominio.md`, `.agents/rules/produto.md`, `.agents/rules/convencoes-codigo.md`, `.agents/rules/stack.md`
- brain: `arquitetura/projetos/atlas-agenda/impacto-gestao-usuarios-visual-por-papel`, `profiles-privilegios-colunas`, `profiles-trigger-barreira-role-tenant`, `profiles-role-tenant-ninguem-troca-pelo-cliente`, `seguranca-duas-camadas-grant-policy`, `arquitetura/projetos/atlas-cobranca/duas-populacoes-usuario-atlas-vs-empresa`
- migrations: `supabase/migrations/20250216091000_profiles_and_helpers.sql`, `20250228090000*`, `20250303100000_invitations_audit.sql`
