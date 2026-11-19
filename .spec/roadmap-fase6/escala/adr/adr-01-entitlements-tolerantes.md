# ADR-01 — Entitlements tolerantes de 20 chaves + `units_limit`

- **Status**: Aceito (design congelado; pré-requisito bloqueante de todas as ADRs de unidade)
- **PRD**: `.spec/roadmap-fase6/escala/PRD.md` §10 W1/W2, §14, RF-34..RF-38
- **UX-SPEC**: §7 (contrato de 20 chaves, `null` = degradação), D11
- **Depende de**: —
- **Bloqueia**: ADR-02..ADR-14 (todas consomem `multiUnidade`, `appMobile` e/ou `unitsLimit`)
- **Escopo de escrita**: `src/hooks/usePlanEntitlements.ts`, `src/hooks/usePlanLimits.ts`, `src/lib/plans.ts`, `src/app/config/plano/PlanCurrentCard.tsx`, `src/internal-admin/backoffice/useBackofficeEntitlements.ts`, `supabase/migrations/`

## Contexto

`usePlanEntitlements` hoje é **all-or-nothing**: `isValidEntitlements` exige as 18 booleanas
presentes em `tenant.entitlements` para aceitar o payload direto; qualquer chave faltando
invalida o objeto inteiro e o hook cai para o catálogo (`get_plans()`). Acrescentar
`multiUnidade`/`appMobile` sem mudar o validador faria **todo payload legado de 18 chaves**
ser rejeitado — o efeito colateral é upsell falso em telas de F2–F5 (risco W2 do PRD).

O catálogo SSoT hoje tem `multi_unidade` **apenas** em `enterprise` (seed de
`20261114000000_plan_catalog_ssot.sql:77`) e **não** tem coluna de limite de unidades. W1 foi
decidido: `premium` recebe `multi_unidade` com `units_limit=2`; `enterprise` ilimitado;
`free`/`starter` = 1 (sem a feature). Sem essa coerência, `units_limit` não teria efeito em
nenhum plano pago intermediário.

## Decisão

### D1 — Validador tolerante por chave (nunca por objeto)

A resolução de entitlements passa a ser **por chave**, com três fontes em precedência:

| Ordem | Fonte | Condição de uso | Chave ausente / tipo inválido |
|---|---|---|---|
| 1 | `tenants.entitlements` (jsonb) | objeto com **≥1** chave conhecida | `false` **apenas naquela chave** |
| 2 | `plans.features` via `get_plans()` | sem fonte 1 utilizável ou chave ausente nela | `false` |
| 3 | default do contrato | sempre | `false` |

Regras invioláveis:

- Chave **ausente** = `false`. Chave com tipo diferente de `boolean` = `false`. Chave
  desconhecida (extra do futuro) é **ignorada** — nunca invalida o objeto.
- Objeto **não utilizável** (não-objeto, `null`, zero chaves conhecidas) **não** vira
  "todas falsas": cai para a fonte 2 (catálogo), preservando o comportamento de degradação
  de hoje.
- O hook retorna `null` **somente** quando não há tenant, não há linha de plano ativa no
  catálogo, ou a RPC falha. Todo consumidor já trata `null` como "sem entitlement"; a
  semântica de `null` não muda.
- As 18 chaves de F2–F5 mantêm nome, tipo e significado. Payload legado de 18 chaves
  continua **válido** e resolve exatamente como antes.

### D2 — Contrato de 20 chaves

`PlanEntitlements` ganha `multiUnidade: boolean` (feature `multi_unidade`) e
`appMobile: boolean` (feature `app_mobile`). `ENTITLEMENT_KEYS` passa de 18 para 20 e a
lista de features mapeadas ganha os dois slugs. Nenhuma renomeação; alias
`AestheticEntitlements` permanece.

### D3 — `units_limit` no catálogo e em `PlanLimits`

- Migration aditiva em `public.plans`: coluna `units_limit integer` com
  `check (units_limit is null or units_limit >= 1)`; `null` = ilimitado.
- Seed/updates idempotentes: `free=1`, `starter=1`, `premium=2`, `enterprise=null`.
- `multi_unidade` adicionada a `premium` (já existe em `enterprise`); `app_mobile` adicionada
  a `premium` e `enterprise` (decisão de produto da fase; free/starter ficam sem).
- `get_plans()` passa a expor `units_limit` (aditivo; `planCatalogRowSchema` aceita o campo
  novo de forma tolerante: ausente → `null`).
- `PlanLimits` ganha `unitsLimit: number | null`, lido por `usePlanLimits` sem mudar a
  assinatura do hook.

### D4 — Consumo de quota na UI

`PlanCurrentCard` ganha a linha "Unidades — {ativas} de {limite}" (∞ quando `null`). O CTA de
criação de unidade distingue **limite atingido** (desabilitado + copy de limite + link para
planos) de **falta de entitlement** (upsell). Nenhuma request a `units` quando
`multiUnidade` é `false`/`null` (RF-34) — o gate precede o hook de dados.

### D5 — Back-office lê o mesmo contrato

`useBackofficeEntitlements` (internal-admin) usa o mesmo mapeamento e a mesma tolerância —
nada de segunda regra. `backoffice_t14/t15` continuam como estão.

## Interface congelada

| Símbolo | Contrato |
|---|---|
| `PlanEntitlements` | 20 booleanas: 18 atuais + `multiUnidade` + `appMobile` |
| `usePlanEntitlements(): PlanEntitlements \| null` | `null` só sem tenant/plano/catálogo; nunca lança; nunca request sensível novo |
| `PlanLimits` | `{ profLimit: number\|null; apptLimit: number\|null; unitsLimit: number\|null }` |
| `usePlanLimits(planSlug, opts?)` | inalterado em assinatura; `unitsLimit` aditivo |
| `planCatalogRowSchema` | campo `units_limit: number\|null` opcional/tolerante |
| Feature slugs | `multi_unidade`, `app_mobile` |

## Consequências

**Positivas**
- Payload legado de F5 continua funcionando; adicionar chaves deixa de ser operação
  all-or-nothing.
- Quota de unidades é dado de catálogo (sem motor novo, sem tabela de quota).
- Uma única regra de gating para `/app` e `/internal-admin`.

**Negativas / custos**
- Duas fontes em precedência exigem teste explícito de mescla (fonte 1 parcial + catálogo).
- `units_limit` em `plans` cria mais um ponto de paridade entre seed e fallback
  apresentacional (`src/lib/plans.ts`).

**Riscos e mitigação**
- *Risco*: tolerância mascarar payload corrompido como "tudo desligado". *Mitigação*:
  telemetria opcional de chaves ausentes; nunca logar valores sensíveis; teste de payload
  `{ prontuario: "sim" }` → só `prontuario=false`, demais vêm do catálogo.
- *Risco*: `?plano`/catálogo divergirem do seed. *Mitigação*: `plans.parity.test.ts` estendido
  para `units_limit` + features novas.

## Escopo

**Entra**
- Validador tolerante, contrato de 20 chaves, `units_limit` no catálogo/RPC/hook/card,
  features novas nos planos decididos, testes de payload legado e de mescla.

**Não entra**
- Motor de quotas genérico, histórico de entitlements, cobrança de unidade excedente,
  preço por unidade (Q2), gate de backend por entitlement (a trava real continua RLS/trigger).

## Arquivos afetados

| Arquivo | Ação |
|---|---|
| `src/hooks/usePlanEntitlements.ts` | mapeamento 20 chaves, resolução por chave |
| `src/hooks/usePlanEntitlements.test.ts` | payload legado, chave ausente, tipo inválido, extra |
| `src/hooks/usePlanLimits.ts` + test | `unitsLimit` |
| `src/lib/plans.ts` + `plans.parity.test.ts` | schema tolerante, paridade do catálogo |
| `src/app/config/plano/PlanCurrentCard.tsx` + test | linha de quota |
| `src/internal-admin/backoffice/useBackofficeEntitlements.ts` | mesmo mapeamento |
| `supabase/migrations/20261216090000_plans_units_limit.sql` | coluna + features + `get_plans()` |

## Critérios de aceite (testáveis)

- [ ] Payload direto com as 18 chaves antigas resolve as 18 com os mesmos valores e
      `multiUnidade=false`, `appMobile=false`.
- [ ] Payload com 1 chave conhecida e 19 ausentes → apenas essa chave reflete o valor; 19 = `false`.
- [ ] Chave com tipo inválido (`"sim"`, `1`) → `false` só naquela chave; objeto não é descartado.
- [ ] Objeto sem nenhuma chave conhecida → fallback ao catálogo (não vira "tudo falso").
- [ ] `free`/`starter` → `unitsLimit=1` e `multiUnidade=false`; `premium` → `2` e `true`;
      `enterprise` → `null` (∞) e `true`.
- [ ] `usePlanLimits` devolve `unitsLimit=null` para slug fora do catálogo, sem lançar.
- [ ] `PlanCurrentCard` mostra "2 de 3" quando 2 ativas e limite 3 (fixture), e ∞ quando `null`.
- [ ] Teste de catálogo roda contra os 4 slugs reais (paridade seed × fallback).

## Dependência / ordem

Primeira da esteira. Nenhum código de unidade pode nascer antes desta ADR mergeada — o
restante assume `multiUnidade` e `unitsLimit` estáveis.
