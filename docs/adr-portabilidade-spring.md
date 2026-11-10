# ADR — Portabilidade futura: Supabase → Java + Spring (FUTURO, não executar)

**Status:** registrado para futuro · **Não executar agora** — o que está funcionando fica como está.
**Motivo do registro (2026-11-09):** decisão consciente de adiar a migração até o sistema exigir mais robustez (escala, custo, compliance), sem fechar a porta.

## Contexto
Backend hoje = Supabase (Postgres + RLS + GoTrue Auth/MFA + Edge Functions Deno). Frontend React consome via `@supabase/supabase-js` (PostgREST direto + `functions.invoke`).

## Decisão
Quando (e se) migrar, o alvo é Java + Spring mantendo: Postgres como fonte, frontend React (só troca a camada de dados), e as fronteiras atuais como molde.

### Mapa de correspondência (guia da migração futura)

| Hoje (Supabase) | Amanhã (Spring) | Observação |
|---|---|---|
| Edge Function por domínio | `@RestController` + `@Service` 1:1 | Contratos `{status, ...}` + códigos de erro viram o REST; manter estáveis desde já |
| RPC `SECURITY DEFINER` + `REVOKE anon/public` | Método de serviço + Spring Security (`@PreAuthorize`) | Autorização sai do banco e vai para a camada de serviço |
| RLS (`auth.uid()`, `auth.jwt()`) | App-level checks + queries escopadas | RLS tenant pode cair; replicar a semântica deny-all em testes |
| GoTrue (TOTP, AAL1/AAL2, Admin API) | Spring Security + lib TOTP (ex.: `dev.samstevens.totp`) + conceito próprio de assurance | **Pedaço mais delicado** — reimplementar enroll/challenge/verify + AAL por request |
| Schemas zod | DTOs + Bean Validation (`@Valid`) | Espelhar nomes/códigos de erro |
| `supabase.from()` no frontend | Endpoints Spring via `axios` + TanStack Query (mesmo shape) | UI/components não mudam |
| Migrations Supabase | Flyway (mesmo SQL, adaptar helpers `auth.*`) | Revisar policies que usam `auth.jwt()` |

### Regras desde já (custo zero, mantêm a porta aberta)
1. Regra de negócio **sempre** em Edge/RPC — nunca em query solta no frontend nem em `select` direto cross-tenant.
2. Novas leituras agregadas atrás de RPC/Edge (padrão já adotado no `/internal-admin`), não `select` direto.
3. Contratos das Edges estáveis e documentados (viram o REST futuro).
4. Decisões de auth documentadas (AAL, downgrade 200 + `mfa_required`, `ensureOperator`, `verify-operator` por request).
5. Sem `tenant_id` vindo do cliente como credencial (vale nos dois mundos).

## Gatilhos para executar (qualquer um)
- Custo/limites Supabase virando gargalo; necessidade de lógica transacional complexa multi-passos no banco; compliance exigindo controle total da pilha de auth; time com capacidade Java ociosa.

## Fora de escopo desta ADR
Nenhuma mudança agora. Sem código, sem migração, sem dependência nova.
