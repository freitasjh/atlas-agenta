# ADR-003 — JWT claim `active` + hook custom-access-token + parse frontend + guard

- **Status**: planned
- **Data**: 2026-11-04
- **PRD**: gestao-usuarios-tenant (MVP — RF-04; RNF-01, RNF-02)
- **Decisões cobertas**: D2 (desativação imediata — lado token/defesa em profundidade)
- **depends-on**: ADR-001

## Decisão

Estender o hook `custom-access-token` (já existente, emite `user_role`, `tenant_id`, `must_change_password`) para também emitir `active`, lido de `profiles.active`. O cliente parseia `active` e o guard força logout quando `active=false`. Isso é **defesa em profundidade** (a trava real é a revogação global em ADR-002 + RLS); a UI apenas melhora a UX e fecha a janela residual.

### 1. Hook `custom-access-token` (alteração)

- **Schema** (`schemas.ts`): `profileRowSchema` adiciona `active: z.boolean()`. (Ou campo separado; manter no mesmo select.)
- **Select**: `profiles` passa a selecionar `role, tenant_id, active`.
- **Claims**: `buildHookClaims` adiciona `active: profile?.active ?? false`. **Tolerância para fluxo de convite**: se o profile estiver ausente (usuário recém-convidado ainda não vinculado a um profile), o hook retorna **200** com claims mínimas `user_role=null`, `tenant_id=null`, `active=false` — não é erro, é estado esperado do fluxo de convite. Apenas erros de leitura do banco (`error !== null`) e shape inválido são fail-closed (500 ⇒ `identity_unavailable` ⇒ login falha). Se `active=false`, o login/refresh ainda retorna token (GoTrue não bloqueia por claim), mas o cliente força logout; alternativa de bloquear no hook não é suportada pelo GoTrue (hook só adiciona claims). Portanto a trava real é a revogação global (ADR-002) + RLS (`current_tenant_id()` nulo não concede acesso a nenhum tenant) + guards frontend (`active=false` ⇒ `DefensiveLogout`).
- **Fail-closed (500)**: apenas (a) erro de leitura do banco (`error !== null`) e (b) shape inválido do profile. Profile ausente ⇒ 200 com claims mínimas (tolerância ao fluxo de convite). Já padrão.

### 2. Parse frontend (`src/lib/auth-claims.ts`)

- `AuthClaims` adiciona `active: boolean`.
- `claimsSchema` adiciona `active: z.boolean()`. Claim ausente ⇒ `null` ⇒ `hasIdentityError` ⇒ `DefensiveLogout` (já padrão em `RequireRole`/`RequireAuth`). Observação: profile ausente no hook emite `active=false` (não ausente), então o cliente recebe `active=false` (não `null`) e o guard trata como `DefensiveLogout` — coerente com a tolerância ao fluxo de convite.
- `parseAuthClaims` retorna `active` no objeto.

### 3. Guard frontend

- `useCurrentUser` (ou `RequireAuth`) expõe `isActive` (derivado de claims).
- Se `isAuthenticated && !isActive` ⇒ forçar logout (chamar `supabase.auth.signOut()`) e redirecionar para `/login` com toast "Acesso desativado. Contate o administrador." (copy final na TASKS).
- `RequireRole` já trata `hasIdentityError`/`hasTenantError` ⇒ `DefensiveLogout`; adicionar branch para `!isActive`.

### 4. Outros pontos de uso

- `resolvePostLoginDestination` não precisa mudar (usuário inativo nunca chega a pós-login).
- Sidebar/capacidades não precisam checar `active` (guard cobre).

## Interface congelada

### Schema (Edge Function)

```ts
// schemas.ts
export const profileRowSchema = z.object({
  role: z.enum(ROLE_VALUES),
  tenant_id: z.string().uuid().nullable(),
  active: z.boolean(),
});

// buildHookClaims
claims: {
  ...claims,
  user_role: profile?.role ?? null,
  tenant_id: profile?.tenant_id ?? null,
  must_change_password: mustChangePassword,
  active: profile?.active ?? false,
}
```

### Frontend

```ts
// src/lib/auth-claims.ts
export interface AuthClaims {
  role: Role;
  tenantId: string | null;
  mustChangePassword: boolean;
  active: boolean;          // NOVO
}

const claimsSchema = z.object({
  user_role: z.enum(ROLES),
  tenant_id: z.string().uuid().nullable(),
  must_change_password: z.boolean(),
  active: z.boolean(),      // NOVO — profile ausente ⇒ false (tolerância convite); ausente ⇒ fail-closed (null)
});
```

### Comportamento

- Claim `active` é reemitido a cada login/refresh (hook roda em toda emissão).
- Usuário desativado com token válido (janela residual antes da revogação global) é bloqueado no cliente ao próximo render do guard (≤ segundos).
- Usuário desativado tentando renovar token recebe `active=false` ⇒ guard força logout.
- Login de usuário inativo: hook emite `active=false` ⇒ cliente força logout imediatamente após login (UX: toast). A revogação global (ADR-002) é a trava real.

## Alternativas consideradas

- **Apenas claim, sem revogação (B para D2)**: descartado — janela de até 1h.
- **Bloqueio só no guard frontend (C)**: descartado como fronteira; mantido como UX.
- **Bloquear no hook (retornar 500 para inativo)**: considerado, mas GoTrue não permite ao hook negar emissão (só adiciona claims); 500 causaria falha de login genérica sem mensagem clara. Optou-se por claim + guard + revogação global.

## Consequências

- Hook existente ganha 1 claim (sem breaking change — cliente antigo ignora claim desconhecida).
- `auth-claims.ts` ganha 1 campo obrigatório (claim ausente ⇒ fail-closed ⇒ `DefensiveLogout`). Profile ausente no hook emite `active=false` (não claim ausente), então o cliente trata como `DefensiveLogout` via guard. Testes de parse devem cobrir.
- `useCurrentUser`/`RequireAuth` ganham branch de `!isActive`.
- Testes: hook (active true/false, profile ausente), parse (active ausente ⇒ null), guard (logout forçado).

## Fora desta decisão

- Mutação de `active` (deactivate/reactivate) → ADR-002.
- UI de gestão → ADR-004.