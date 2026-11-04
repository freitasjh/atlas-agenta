# ADR-002 — Edge Functions privilegiadas: deactivate/reactivate/change-role/unlink + invite-member professional_id + accept-invitation vínculo + revogação de sessão

- **Status**: planned
- **Data**: 2026-11-04
- **PRD**: gestao-usuarios-tenant (MVP — RF-01, RF-03, RF-04, RF-05; RNF-01, RNF-05, RNF-07)
- **Decisões cobertas**: D2 (desativação imediata + claim active), D3 (vínculo via convite — lado servidor)
- **depends-on**: ADR-001

## Decisão

Toda mutação de colunas privilegiadas de `profiles` e vínculo `professional↔profile` passa por Edge Functions com service role (security definer). O cliente nunca toca essas colunas. Padrão: validar identidade do ator (JWT + profile), validar tenant ator vs alvo, executar em transação, registrar `audit_log`, revogar sessão quando necessário.

### 1. `deactivate-user` (nova Edge Function)

- **Input** (zod): `{ target_user_id: uuid }`.
- **Autorização**: ator `admin` do mesmo tenant do alvo; super_admin cross-tenant via caminho explícito (auditado). Rejeitar auto-desativação se for o último admin ativo.
- **Ações** (transação):
  1. `SELECT ... FROM profiles WHERE id = target FOR UPDATE` (lock).
  2. Validar mesmo tenant; validar não é o último admin ativo (count de admins ativos do tenant > 1, ou alvo não é admin).
  3. `update profiles set active=false, deactivated_at=now(), deactivated_by=actor where id=target`.
  4. `insert audit_log (tenant_id, actor_id, action='user.deactivated', target_type='profile', target_id=target, metadata={before:{active:true}, after:{active:false}})`.
  5. `supabase.auth.admin.signOut(target, 'global')` — revoga refresh tokens de todas as sessões (bloqueio imediato, D2-A). Falha de revogação ⇒ logar warning mas não desfazer (defesa em profundidade via claim `active` no próximo refresh).
- **Output**: `{ ok: true }` ou erro tipado (`forbidden`, `last_admin`, `not_found`, `internal_error`).
- **Efeito**: usuário perde acesso imediatamente (revogação global) + claim `active=false` fail-closed no próximo login/refresh (ADR-003).

### 2. `reactivate-user` (nova Edge Function)

- **Input**: `{ target_user_id: uuid }`.
- **Autorização**: admin do mesmo tenant.
- **Ações**: `active=true`, `deactivated_at=null`, `deactivated_by=null`; audit `user.reactivated`. Não recria sessão (usuário re-loga).
- **Output**: `{ ok: true }`.

### 3. `change-user-role` (nova Edge Function)

- **Input** (zod): `{ target_user_id: uuid, new_role: enum(super_admin? no — admin só troca entre admin/professional/receptionist do tenant) }`. Admin de tenant não pode criar super_admin nem alterar super_admin. Validar `new_role ∈ {admin, professional, receptionist}`.
- **Autorização**: admin do mesmo tenant; alvo não é super_admin.
- **Validações**: não remover último admin ativo; não permitir self-demotion sem confirmação forte (UI confirma); super_admin não alterável por admin de tenant.
- **Ações**: `update profiles set role=new_role, role_changed_at=now(), role_changed_by=actor`; audit `user.role_changed` com metadata `{from, to}`.
- **Output**: `{ ok: true }`. UI informa "efeito no próximo acesso" (token stale — claim `user_role` reemitido no próximo refresh/login).

### 4. `unlink-professional-profile` (nova Edge Function — RF-09, P2)

- **Input**: `{ professional_id: uuid }`.
- **Autorização**: admin do mesmo tenant.
- **Ações**: `update professionals set profile_id=null where id=professional`; opcionalmente desativar profile (decisão na TASKS — padrão: apenas desvincula, não desativa, para preservar histórico); audit `professional.unlinked`.
- **Guarda**: se houver agendamentos futuros vinculados ao profile, apenas avisar (não bloquear) — decisão final na TASKS.
- **Output**: `{ ok: true }`.

### 5. `invite-member` (alteração — parâmetro opcional `professional_id`)

- **Input** (zod): adicionar `professional_id?: uuid` opcional ao body existente (`email`, `role`).
- **Validação**: se `professional_id` presente, validar que o professional pertence ao tenant do ator e não tem `profile_id` vinculado (evitar duplicata). Se `role !== 'professional'` e `professional_id` presente ⇒ erro `invalid_body`.
- **Ação**: insert `invitations` com `professional_id` (nullable, já adicionado em ADR-001).
- **Compatibilidade**: parâmetro opcional (RNF-09) — convites existentes sem `professional_id` seguem funcionando.
- **Audit**: metadata inclui `professional_id` quando presente.

### 6. `accept-invitation` (alteração — vínculo ao aceitar)

- **Input**: sem mudança (token + password opcional).
- **Ação adicional**: após upsert do profile, se `invitation.professional_id` presente e `role === 'professional'`, setar `professionals.profile_id = userId` (transação, validar tenant). Idempotente (se já vinculado, no-op).
- **Audit**: `professional.linked` quando vínculo ocorre.
- **Compatibilidade**: convites sem `professional_id` não tentam vincular.

### 7. Revogação de sessão (D2)

- Usar `supabase.auth.admin.signOut(userId, 'global')` em `deactivate-user` (e opcionalmente em `change-user-role` crítico — decisão: não revogar em troca de papel no MVP; efeito no próximo acesso, conforme RF-05).
- Claim `active` (ADR-003) é a defesa em profundidade: mesmo se a revogação falhar, o próximo refresh/login fail-closed.

### Padrões transversais (todas as EFs novas)

- CORS headers (como existentes).
- zod para body (schemas.ts por função).
- `resolveIdentity(service, token)` lendo `profiles` com service role.
- Erros tipados com códigos estáveis (para frontend mapear).
- Logs técnicos sem PII (sem e-mail/telefone/id em claro quando evitável).
- Auditoria em `audit_log` com `actor_id`, `target_id`, `metadata` before/after.
- Transação: usar RPC security definer ou múltiplas queries com rollback manual (Edge Function não tem transação automática — preferir RPC `security definer` para operações multi-tabela; documentar na TASKS).

## Interface congelada

### Contratos de Edge Function

| Função | Método | Input | Output sucesso | Erros |
|---|---|---|---|---|
| `deactivate-user` | POST | `{ target_user_id: uuid }` | `{ ok: true }` | `unauthenticated` 401, `forbidden` 403, `not_found` 404, `last_admin` 409, `internal_error` 500 |
| `reactivate-user` | POST | `{ target_user_id: uuid }` | `{ ok: true }` | mesmos |
| `change-user-role` | POST | `{ target_user_id: uuid, new_role: 'admin'\|'professional'\|'receptionist' }` | `{ ok: true }` | `unauthenticated` 401, `forbidden` 403, `not_found` 404, `last_admin` 409, `invalid_body` 400, `internal_error` 500 |
| `unlink-professional-profile` | POST | `{ professional_id: uuid }` | `{ ok: true }` | `unauthenticated` 401, `forbidden` 403, `not_found` 404, `internal_error` 500 |
| `invite-member` (alterada) | POST | `{ email, role, professional_id? }` | `{ ok: true, invitation_id, expires_at }` | existentes + `professional_not_found`/`professional_already_linked` 400 |
| `accept-invitation` (alterada) | POST | `{ token, password? }` | `{ ok: true }` | existentes |

### RPCs opcionais (decisão na TASKS)

Se a transação multi-tabela for feita via RPC security definer, nomes congelados:
- `deactivate_user(p_target uuid, p_actor uuid)` returns void
- `reactivate_user(p_target uuid, p_actor uuid)` returns void
- `change_user_role(p_target uuid, p_actor uuid, p_new_role text)` returns void
- `unlink_professional_profile(p_professional uuid, p_actor uuid)` returns void
- `link_professional_on_accept(p_professional uuid, p_user uuid, p_tenant uuid)` returns void

### Auditoria (audit_log.action)

Novos valores de `action`:
- `user.deactivated`, `user.reactivated`, `user.role_changed`
- `professional.linked`, `professional.unlinked`
- (já existentes) `invitation.created`, `invitation.accepted`, `invitation.revoked`

Metadata padrão: `{ before: {...}, after: {...}, professional_id? }`.

### Revogação

- `deactivate-user` chama `auth.admin.signOut(target, 'global')` (best-effort; falha não desfaz a desativação, claim `active` cobre).
- Troca de papel não revoga sessão no MVP (efeito no próximo acesso).

## Alternativas consideradas

- **Bloqueio apenas no próximo request (B para D2)**: descartado — janela de até 1h de acesso indevido.
- **Bloqueio só no guard frontend (C)**: descartado — trava de UI não é fronteira (OWASP, `.agents/rules/seguranca-multitenant.md`).
- **Revogar sessão em troca de papel**: descartado no MVP (complexidade; efeito no próximo acesso aceitável para RF-05).
- **Auto-cadastro de professional no aceite (B para D3)**: adiado para RF-10 (P3), não MVP.

## Consequências

- 4 novas Edge Functions + 2 alteradas (invite-member, accept-invitation) — compatibilidade retroativa (parâmetros novos opcionais).
- zod schemas por função (padrão do projeto).
- Transação multi-tabela: preferir RPC security definer (a decidir na TASKS) para atomicidade.
- Revogação global derruba todas as sessões do usuário (intencional para desativação).
- Auditoria completa de mudanças (RNF-05).
- Edge Functions de deactivate/change-role devem validar último admin com lock (mitiga concorrência — risco herdado).

## Fora desta decisão

- Claim `active` no JWT e parse frontend → ADR-003.
- UI de gestão (tabs, ações) → ADR-004.
- Onboarding por papel e redirect → ADR-006 (fase 2).