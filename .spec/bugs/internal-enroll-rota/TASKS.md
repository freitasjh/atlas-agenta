# BUG — internal-enroll-rota (Bugfix fast-track)

## Bug
Operador novo (zero fatores MFA) loga (aal1) e cai em `/internal-admin/mfa`, que exige código de um autenticador que nunca foi cadastrado: erro "Nenhum autenticador ativo" sem saída. Dead-end; único caminho é digitar `/enroll` manual.

## Causa raiz
- `verify-operator` retorna só `{is_operator, aal, user_id}` — sem contagem de fatores enrolados.
- `useInternalOperator` (linhas 65-73) mapeia todo operador com `aal!=="aal2"` para `mfa_required`, sem distinguir "nunca enrolou" de "sessão aal1".
- Guard manda `mfa_required` → `/mfa`; `/mfa` não tem CTA para `/enroll`.
- Evidência: InternalMfaPage.tsx:61-63 (erro sem saída); router 228-235 (enroll acessível mas inalcançável por navegação).

## Solução
1. `verify-operator` passa a retornar `enrolled_factors: number` (aditivo, sem quebrar contrato).
2. Hook: operador + aal!=aal2 + enrolled==0 → status novo `enroll_required`; enrolled>0 → `mfa_required` (inalterado).
3. Guard: `enroll_required` → `/internal-admin/enroll`.
4. `/mfa`: CTA "Ativar autenticador" → `/enroll` (rede de segurança p/ sessão antiga).

## Arquivos + impacto
- `supabase/functions/verify-operator/handler.ts` (+ teste Deno).
- `supabase/functions/_shared/internal-operator.ts` (expõe contagem; sem mudar fail-closed).
- `src/internal-admin/useInternalOperator.ts` (+ teste) + `RequireInternalOperator.tsx` (rota enroll) + `InternalMfaPage.tsx` (CTA).
- Sem migration, RLS, hook, RPCs, layout.

## Testes
- Deno: resposta inclui enrolled_factors; 0 vs >0.
- Vitest: mapping enroll_required/mfa_required; guard redirect /enroll; CTA renderiza no erro sem-autenticador.
- E2E: operador fresco → login → auto /enroll → enroll → aal2 → home; operador com fator → /mfa normal.

## Riscos
- Contrato verify-operator muda (campo novo) — aditivo, callers ignoram se ausente (default 0? Não: ausente em versão antiga = tratar como mfa_required legado). Definir fallback explícito.
- Loop redirect se enroll falhar — enroll tem saída própria (login), sem ciclo.
