# ADR-01 — Entitlements T1.2: chaves `estoque` e `comissaoProduto`

- Status: proposto

## Contexto

Fase 3 (salão/barbearia) exige gating por plano+segmento para estoque e comissão por produto (PRD §2, §8 #8). O contrato congelado `usePlanEntitlements -> {prontuario,pacotes,aestheticCheckout} | null` (Fase 2 ADR-01) é a única fonte de gating. Precisa ganhar duas chaves sem quebrar chamadores existentes (degradação: `null` = ausente/falha → conteúdo legível, escrita bloqueada + upsell). `segment-features` continua dono de `payments`/`commission`/`combos`; entitlements não substituem segmento.

## Decisão

Congelar a interface T1.2 estendida:

```ts
// src/hooks/usePlanEntitlements.ts
interface PlanEntitlements {
  prontuario: boolean;
  pacotes: boolean;
  aestheticCheckout: boolean;
  estoque: boolean;          // NOVO Fase 3
  comissaoProduto: boolean;  // NOVO Fase 3
}
function usePlanEntitlements(): PlanEntitlements | null
```

Regras: mesmas do contrato atual (nunca lança, `null` degrada, chaves exatas, sem chaves extras). `estoque`/`comissaoProduto` mapeados de features do catálogo SSoT (`estoque`, `comissao_produto`) com fallback `false` quando plano não tem. Chamadores existentes (prontuário/pacotes/checkout) inalterados. Sem motor de quotas.

## Consequências

- Positivas: contrato único para gating Fase 3; degradação preservada; sem backend.
- Negativas/risco: hook muda de forma → atualizar mocks de teste que fixam chaves; componentes que leem entitlements passam a tratar 2 chaves novas (null-safe).
- Defaults §8: #7 (dado segue legível sem entitlement).

## Escopo

Entra: hook + testes + empty/upsell reutilizável. Não entra: quotas, catálogo, Edge, RLS, telas G12/G13/G15.

## Arquivos afetados

- `src/hooks/usePlanEntitlements.ts` (interface + mapeamento)
- `src/hooks/usePlanEntitlements.test.ts` (chaves exatas, null-safe, tabela de casos)
- Chamadores mockados (ajuste de tipo, sem mudança de comportamento)

## Critérios de aceite (testáveis)

1. `usePlanEntitlements()` com tenant sem campos → `null`; com campos válidos → objeto com exatamente 5 chaves, sem extras.
2. Dado sujo (tipo errado/faltante) → `null`, nunca throw.
3. Componente com entitlements `null` renderiza conteúdo legível + upsell, sem crash e sem request novo (teste com mock `null`).
4. `typecheck + build + vitest` verdes; nenhum import novo de rede/Edge.

## Dependência

Nenhuma (primeira da cadeia; base de ADR-08/09/10/11).