# ADR-01 — Entitlements Fase 4: chaves `deposito`, `waitlist`, `campanhas`, `fidelidade`, `checkoutSelfService`

- Status: proposto

## Contexto

A Fase 4 (retenção e no-show) exige gating por plano/segmento para depósito/sinal, waitlist, campanhas, fidelidade e checkout self-service (PRD §2, §8, UX-SPEC A–H). O contrato congelado `usePlanEntitlements -> {prontuario, pacotes, aestheticCheckout, estoque, comissaoProduto} | null` (Fase 2 ADR-01 + Fase 3 ADR-01) é a única fonte de gating. Precisa ganhar cinco chaves sem quebrar chamadores existentes. Degração obrigatória: `null` = ausente/falha/dado sujo → conteúdo legível, escrita bloqueada + upsell. `segment-features` continua dono de `payments`/`commission`/`combos`; entitlements não substituem segmento. Não há motor de quotas novo.

## Decisão

Congelar a interface T1.2 estendida:

```ts
// src/hooks/usePlanEntitlements.ts
interface PlanEntitlements {
  prontuario: boolean;
  pacotes: boolean;
  aestheticCheckout: boolean;
  estoque: boolean;
  comissaoProduto: boolean;
  deposito: boolean;            // NOVO Fase 4
  waitlist: boolean;            // NOVO Fase 4
  campanhas: boolean;           // NOVO Fase 4
  fidelidade: boolean;          // NOVO Fase 4
  checkoutSelfService: boolean;  // NOVO Fase 4 (T1.3)
}
function usePlanEntitlements(): PlanEntitlements | null
```

Regras: mesmas do contrato atual (nunca lança, `null` degrada, chaves exatas, sem extras). As cinco novas chaves mapeiam features do catálogo SSoT (`deposito`, `waitlist`, `campanhas`, `fidelidade`, `checkout_self_service`) com fallback `false` quando o plano não tem. Chamadores existentes (prontuário/pacotes/checkout/estoque/comissão) inalterados. `tenant.entitlements` válido mantém precedência. Sem motor de quotas.

## Consequências

- Positivas: contrato único para gating da Fase 4; degradação preservada; sem backend nesta ADR.
- Negativas/risco: hook muda de forma → atualizar mocks de teste que fixam chaves; componentes que leem entitlements passam a tratar 5 chaves novas (null-safe); seed do catálogo precisa incluir features novas por plano (responde pergunta 12 do PRD).
- Defaults PRD §7: conteúdo segue legível sem entitlement.

## Escopo

Entra: hook + testes + gating/upsell reutilizável. Não entra: quotas, catálogo, Edge, RLS, telas A–H.

## Arquivos afetados

- `src/hooks/usePlanEntitlements.ts` (interface + mapeamento + validação exata)
- `src/hooks/usePlanEntitlements.test.ts` (10 chaves exatas, null-safe, tabela de casos)
- Chamadores mockados (ajuste de tipo, sem mudança de comportamento)

## Critérios de aceite (testáveis)

1. `usePlanEntitlements()` com tenant sem campos → `null`; com campos válidos → objeto com exatamente 10 chaves, sem extras.
2. Dado sujo (tipo errado/faltante) → `null`, nunca throw.
3. Componente com entitlements `null` renderiza conteúdo legível + upsell, sem crash e sem request novo (teste com mock `null`).
4. `typecheck + build + vitest` verdes; nenhum import novo de rede/Edge.
5. Catálogo mapeia `deposito/waitlist/campanhas/fidelidade/checkoutSelfService` conforme features do plano.

## Dependência

Nenhuma (primeira da cadeia; base de ADR-02..ADR-18).
