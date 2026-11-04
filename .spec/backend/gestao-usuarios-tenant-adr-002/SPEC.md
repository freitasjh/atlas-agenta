# Architecture & Software Specification — ADR-002 (Edge Functions Privilegiadas)

**Feature slug:** `gestao-usuarios-tenant-adr-002`
**ADR de origem:** `.spec/prd/gestao-usuarios-tenant/ADRs/ADR-002-edge-functions-privilegiadas/ADR.md`
**Depende de:** ADR-001 (schema).
**Escopo:** Backend (Edge Functions Supabase + RPCs). Frontend em ADR-004.

## 1. Decisoes (RESEARCH D2, D3)

- Desativacao: revogacao global de sessao (signOut('global')) + claim active fail-closed no hook (ADR-003). Guard frontend e UX.
- Vinculo profissional<->login: convite com professional_id pre-cadastrado (ADR-005 detalha; aqui a Edge Function aceita o parametro).

## 2. Edge Functions

### 2.1 deactivate-user (nova)
- Auth: admin do tenant (validar current_role_name()='admin' e tenant match).
- Input: { user_id }.
- Logica: (1) validar que user pertence ao tenant; (2) validar nao e o ultimo admin ativo (lock transacional); (3) setar active=false, deactivated_at=now(), deactivated_by=actor; (4) revogar sessoes (signOut('global')); (5) audit_log.
- Output: { ok: true } ou erro (400/403/409).

### 2.2 reactivate-user (nova)
- Auth: admin do tenant.
- Input: { user_id }.
- Logica: setar active=true, limpar deactivated_*; audit_log. Nao reenvia convite (opcional).

### 2.3 change-user-role (nova)
- Auth: admin do tenant.
- Input: { user_id, new_role }.
- Logica: validar tenant; validar nao remover ultimo admin (se demotion de admin); setar role + role_changed_at/by; audit_log; revogar sessoes (efeito no proximo acesso).
- Output: { ok: true }.

### 2.4 unlink-professional-profile (nova)
- Auth: admin do tenant.
- Input: { professional_id }.
- Logica: validar tenant; setar professionals.profile_id=null; opcionalmente desativar profile; audit_log.

### 2.5 invite-member (modificar)
- Input adicional: professional_id (opcional).
- Logica adicional: validar que professional pertence ao tenant e nao tem profile vinculado; armazenar em invitation.

### 2.6 accept-invitation (modificar)
- Logica adicional: ao criar profile, se invitation.professional_id presente, setar professionals.profile_id = new user id (transacao). Desnormalizar email em profile.

## 3. RPCs (security definer)

- deactivate_user(user_id) — wrapper opcional; preferir Edge Function service role.
- Lock transacional: SELECT ... FOR UPDATE no profile do tenant para evitar race no "ultimo admin".

## 4. Invariantes

| Entidade | Invariante |
|----------|------------|
| profiles | Pelo menos 1 admin ativo por tenant (enforced na Edge Function). |
| professionals | profile_id, se not null, pertence ao mesmo tenant. |
| invitations | professional_id, se not null, pertence ao mesmo tenant e nao tem profile vinculado. |

## 5. Functional Requirements

- RF-04 (desativacao): Edge Function + revogacao de sessao.
- RF-03 (vinculo): invite-member professional_id + accept-invitation vinculacao.
- RF-05 (mudanca de papel): change-user-role (backend; frontend em ADR-006).
- RNF-01, RNF-02, RNF-05, RNF-07.

## 6. Delta Specs

- .agents/rules/dominio.md: Edge Functions listadas; invariantes.
- .agents/rules/seguranca-multitenant.md: revogacao de sessao em desativacao.

## 7. Criterios de Aceite

- deactivate-user bloqueia ultimo admin ativo (409).
- deactivate-user revoga sessoes (usuario nao renova token).
- change-user-role registra auditoria e revoga sessoes.
- invite-member com professional_id valida tenant e nao duplica vinculo.
- accept-invitation vincula professional.profile_id em transacao.
- unlink-professional-profile desvincula e registra auditoria.
- Testes de integracao (Edge Functions) passando.
