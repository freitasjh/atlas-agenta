# DÉBITO TÉCNICO — login-guard-hop (P3)

## Contexto
`InternalLoginPage` navega fixo para `/internal-admin/mfa` pós-login. Com a rota `enroll_required` (bugfix internal-enroll-rota), o guard redireciona `mfa→enroll` — funciona, mas custa 1 hop com render do `/mfa` no meio.

## Proposta (follow-up, não bloqueante)
Login navegar para rota do guard/home (`/internal-admin`) e deixar o `RequireInternalOperator` decidir o destino (`/enroll`, `/mfa` ou conteúdo), eliminando o hop.

## Aceite
- Login como virgem → cai direto em `/enroll` sem passar pelo `/mfa`.
- Login com fator, sessão aal1 → cai em `/mfa`.
- Vitest do login atualizado; sem regressão E2E.

## Origem
Sugestão QA B4 em `internal-enroll-rota` (2026-11-09). Bug principal fechado; isto é polimento.
