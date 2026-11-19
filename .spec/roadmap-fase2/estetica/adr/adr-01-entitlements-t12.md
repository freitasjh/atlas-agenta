# ADR-01 — T1.2 Entitlements leitura: contrato congelado + gating só-UI

- Status: proposto

## Contexto

PRD Fase 2 exige gating por entitlement (`prontuario`, `pacotes`, `aestheticCheckout`) com empty+upsell e degradação sem travar (dado gravado segue legível, só escrita bloqueada). Hoje `usePlanEntitlements` retorna `{planName, usage, limit, isAvailable} | null` (leitura T1.1, nunca lança, `null` = ausente/falha). `segment-features.payments=false` p/ clínica. Nenhum motor de quotas neste escopo (NÃO entra).

## Decisão

Congelar a interface T1.2 como única fonte de gating Fase 2:

```ts
// src/hooks/usePlanEntitlements.ts
interface AestheticEntitlements { prontuario: boolean; pacotes: boolean; aestheticCheckout: boolean }
function usePlanEntitlements(): AestheticEntitlements | null
```

Regras: `null` = ausente/falha/sujo → chamador degrada (conteúdo legível, escrita bloqueada + upsell), nunca trava, nunca request sensível novo, nunca lança. Sem entitlement, escrita bloqueada na UI; trava real continua sendo RLS. `segment-features` intocado (continua dono de `payments` salão/barbearia; `aestheticCheckout` vive no entitlement, não no segmento).

## Consequências

- Positivas: contrato único p/ G4/G6/G5; chamadas resilientes; sem backend.
- Negativas/risco: hook atual muda de forma → atualizar os 5 mocks de teste que fixam `() => null` (compatível, continuam válidos) + `PlanoPage`/`PlanBadge` que leem `planName/usage/limit` passam a ler `null`-safe ou novo contrato (decidido nesta ADR, sem meio-termo).
- Defaults §8 aplicados: #7 (sem entitlement dado segue legível).

## Escopo

Entra: hook + testes + empty/upsell pattern reutilizável (componente ou helper). Não entra: quotas, catálogo, Edge, RLS, qualquer tela G4–G6.

## Arquivos afetados

- `src/hooks/usePlanEntitlements.ts` (reescrita p/ contrato acima)
- `src/hooks/usePlanEntitlements.test.ts` (contrato congelado: null-safe, nunca lança, chaves exatas)
- `src/app/agenda/PlanBadge.tsx`, `src/app/config/plano/PlanoPage.tsx` (adaptação ao novo contrato)
- Chamadores mockados: `AgendaPage.*.test.tsx`, `PlanoPage.test.tsx` (ajuste de tipo, sem mudança de comportamento)

## Critérios de aceite (testáveis)

1. `usePlanEntitlements()` com tenant sem campos → `null`; com campos válidos → `{prontuario, pacotes, aestheticCheckout}` exatos, sem chaves extras.
2. Dado sujo (tipo errado/faltante) → `null`, nunca throw (teste com tabela de casos).
3. Componente com entitlements `null` renderiza conteúdo legível + upsell, sem crash e sem request à rede (teste com mock `null`).
4. `typecheck + build + vitest` verdes; nenhum import novo de rede/Edge.

## Dependência

Nenhuma (primeira da cadeia; base de ADR-03/05/06).
