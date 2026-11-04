# PRD — Gestão de Usuários do Tenant + Visual por Papel (MVP)

> **prd-id**: `gestao-usuarios-tenant`
> **Dono da aprovação**: Product Owner (fundador)
> **Status**: approved
> **Mapa**: §1, §2, §5, §6, §7, §9, §16 obrigatórias.

## 1. Problema
Membros do tenant são geridos apenas por convite; `professionals` é desacoplado do login; não há tela de usuários ativos nem visual por papel; todos compartilham o mesmo app.
> ❓ Validação: a dor existe hoje e dói o bastante? (sim/não)

## 2. Objetivo
Admin gerencia usuários ativos (listar, editar nome, trocar papel, desativar/reativar) e vincula profissional↔login via convite; professional/receptionist recebem menu e rotas próprios, com isolamento RLS.
> ❓ Validação: objetivo mensurável e não é solução? (sim/não)

## 3. Contexto e evidências
Baseline: `/app/config/membros` (convites), `ProfissionaisPage` (`profile_id` read-only), `usePermissions`, RLS em `profiles`, Edge Functions de convite. Evidência: relatório de planejamento 2026-11-03.
## 4. Público e impacto
Afetados: admin (governança), professional (agenda própria), receptionist (agenda/clientes), super_admin (plataforma). Impacto: onboarding mais rápido e menos confusão de papéis.
## 5. Métricas de sucesso
| Métrica | Como medir | Meta |
|---|---|---|
| Profissionais com login vinculado | count(profile_id not null)/professionals | ≥80% em 30 dias |
| Onboarding convite→primeiro acesso | timestamp aceite - envio | <24h |
| Incidentes cross-tenant em profiles | testes RLS + auditoria | 0 |
| Cobertura fluxos críticos | testes unit/int/e2e | ≥80% |
> ❓ Validação: ao menos uma métrica tem "como medir"? (sim)

## 6. Escopo (MVP)
RF-01 tela Usuários (ativos/inativos, ações admin); RF-02 convites integrados (tabs); RF-03 convite vinculado a profissional; RF-04 desativar/reativar; RF-06 visual professional; RF-07 visual receptionist. RNF-01, RNF-02, RNF-05, RNF-09.
## 7. NÃO entra
RF-05, RF-08–RF-11; RNF-03, RNF-04, RNF-06–RNF-08, RNF-10; SSO/SAML/SCIM, grupos custom, app nativo, hard delete (exceto LGPD super admin), MFA.
> ❓ Validação: o que não entra está declarado? (sim)

## 8. Riscos e mitigação
| Risco | Mitigação |
|---|---|
| Lockout por desativar último admin | trigger + UI desabilita |
| Drift tenant profile↔professional | FK composta por tenant + validação EF |
| Token stale após mudança de papel | re-login/refresh + aviso UI |
| Regressão RLS | testes integração profile outro tenant |
## 9. Requisitos funcionais
- RF-01: Admin lista/edita/troca papel/desativa profiles do próprio tenant; guards de último admin.
- RF-02: Aba "Ativos" e "Convites" na mesma tela; aceite move para Ativos.
- RF-03: Convite pode vincular `professional_id`; aceite seta `professionals.profile_id`.
- RF-04: Soft delete (`active`, timestamps, ator) com bloqueio de acesso e auditoria.
- RF-06: Professional vê menu/agenda/dados próprios; rotas admin/financeiro bloqueadas.
- RF-07: Receptionist opera agenda/clientes; financeiro/configurações bloqueados.
> ❓ Validação: cada requisito verificável por teste? (sim)

## 10. Histórias de usuário
- Dado admin autenticado, Quando abre Usuários, Então vê membros do próprio tenant.
- Dado convite aceito, Quando usuário loga, Então aparece em Ativos.
- Dado professional pré-cadastrado, Quando aceita convite vinculado, Então acessa só própria agenda.
- Dado admin desativa usuário, Quando usuário tenta acessar, Então é bloqueado.
- Dado professional, Quando acessa URL financeira, Então é redirecionado.
- Dado receptionist, Quando acessa cobranças, Então é bloqueado.
## 11. UX / experiência
Fluxo: Usuários → Ativos/Convites → ações com confirmação (Dialog), badges de status, empty/loading/error states, redirect pós-login por papel, menu filtrado.
## 12. Dependências
Migrations aditivas em `profiles`/`invitations`; RLS existente; Edge Functions de convite; `usePermissions`; TanStack Query; audit_log.
## 13. Segurança
RLS em `profiles`; cliente não envia tenant_id; RPC/EF security definer validam ator vs alvo; claims JWT (role, tenant_id, active); professional/receptionist sem financeiro; auditoria de mudanças.
## 14. Perguntas abertas
1. E-mail em profiles: desnormalizar via trigger ou Edge Function? Recomendação: trigger.
2. Desativação bloqueia imediatamente ou próximo request? Recomendação: claim active + guard.
3. Receptionist pode CRUD clientes mas não cobranças — confirmar.
4. Professional vê clientes (leitura) — confirmar.
5. Renomear Membros → Usuários ou criar nova? Recomendação: evoluir.
## 15. PICCO
<task>Entregar MVP de gestão de usuários do tenant e visual por papel (RF-01,02,03,04,06,07; RNF-01,02,05,09)</task>
<context>Atlas Agenda multi-tenant; stack React+Vite+Supabase; RLS; migrations aditivas; roles existentes; convites existentes.</context>
<constraints>sem hard delete; sem novos roles; sem RF/RNF futuros; suite verde</constraints>
<acceptance>admin gerencia users; convite vincula professional; desativação bloqueia; menus/rotas por papel; RLS tests verdes</acceptance>
## 16. Aprovação
- **Veredito**: aprovado
- **Data**: 2026-11-04
- **Portão**: P0→P1 (PRD aprovado pelo owner)
> ✅ Validação: owner aprovou antes de qualquer ADR? (sim)
