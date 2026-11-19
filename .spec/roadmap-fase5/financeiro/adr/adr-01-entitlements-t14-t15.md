# ADR-01 — Entitlements T1.4/T1.5 (interface congelada + gating nulo)

- **Status**: `proposed`
- **Depende de**: nenhuma (fundação; PRD `.spec/roadmap-fase5/financeiro/PRD.md` + `UX-SPEC.md`).
- **RFs**: RF-06, RF-12, RF-17, RF-26, RF-31, RF-35, RF-38, RF-39.

## Contexto

`usePlanEntitlements` (contrato T1.2, 10 chaves) é a única fonte de gating. Fase 5 precisa de 8 novas capacidades sem motor novo de quotas: `nfce, recorrencia, contasPagar, conciliacao, dreFluxo, exportContabil, backofficeT14, backofficeT15`. PRD §2 proíbe motor novo; UX-SPEC §17 exige default `false` + `null` degrada. RF-39 exige gating nulo legível, sem crash, sem request sensível.

## Decisão

Estender `PlanEntitlements` com as 8 chaves (total 18), mapeadas de `plans.features` do catálogo SSoT (+ precedência `tenant.entitlements` quando válido):

| Entitlement | Feature flag catálogo |
|---|---|
| nfce | `nfce` |
| recorrencia | `recorrencia` |
| contasPagar | `contas_pagar` |
| conciliacao | `conciliacao` |
| dreFluxo | `dre_fluxo` |
| exportContabil | `export_contabil` |
| backofficeT14 | `backoffice_t14` |
| backofficeT15 | `backoffice_t15` |

Regras congeladas: `null` = ausente/falha/sujo → chamador degrada (conteúdo legível, escrita bloqueada + upsell), nunca trava, nunca dispara request sensível novo, nunca lança. Chaves extras ignoradas. `isValidEntitlements` exige as 18 booleanas no caminho direto. RLS continua sendo o trava real.

## Consequências

- Positivas: um único contrato para toda Fase 5; UIs nascem gated sem retrabalho; degradação testável.
- Negativas/riscos: `isValidEntitlements` estrito invalida payloads T1.x antigos sem as 8 chaves → caem para `null` (catálogo resolve; aceitável, degrada legível). Mitigação: validação tolerante documentada em teste (direto válido com 10 chaves legadas → completa com `false`? **Não** — decisão: mantém estrito, catálogo cobre; teste fixa comportamento).
- Dívida: sem motor de quotas/limites (fora de escopo, PRD §2).

## Escopo

- Entra: interface + mapeamento + `ENTITLEMENT_KEYS` + testes contrato + doc hub Financeiro (rota/sidebar skeleton gated, sem tabelas).
- Não entra: nenhuma tabela fiscal/financeira; nenhuma RPC nova; nenhum request Edge.

## Arquivos afetados

- `src/hooks/usePlanEntitlements.ts` (interface + keys + features + map + direct path)
- `src/hooks/usePlanEntitlements.test.ts` (contrato 18 chaves, null paths)
- `supabase/migrations/*_plan_catalog_fase5_features.sql` (seed/docs das 8 features no catálogo — só catálogo, sem tabelas novas)
- `src/app/financeiro/` (skeleton hub + sidebar entry gated por `payments===true` + entitlements; sem dados)
- `.spec/roadmap-fase5/financeiro/adr/adr-01-*.md` (este arquivo)

## Critérios de aceite (testáveis)

1. `usePlanEntitlements` retorna as 18 chaves quando catálogo tem as 8 features; cada uma `true` só com sua flag.
2. Catálogo sem flags / plano ausente / erro rede / dado sujo → `null`; chamador renderiza upsell legível sem request a tabelas fase-5 (assert via mock + `list_network_requests` sem `/rest/v1/fiscal*`, `/receivables`, etc.).
3. `tenant.entitlements` direto com 18 booleanas → usa direto sem query catálogo.
4. `tsc --noEmit` + `vitest run usePlanEntitlements` verdes; RLS zero cross (sem tabelas novas, nada a vazar).
