# ADR-11 — Back-office T1.4/T1.5 (Operação + suspender/retomar + MRR/churn/NFCe)

- **Status**: `approved`
- **Depende de**: ADR-01 (gating `backofficeT14/T15`) + ADR-04 (subscriptions) + ADR-03 (NFCe métricas). Fecho da cadeia.
- **RFs**: RF-32, RF-33, RF-34, RF-35.

## Contexto

Super admin opera: aba Operação em internal-admin/empresas (assinaturas membership dos tenants, inadimplência, auditoria), suspender/retomar tenant inadimplente (bloqueado → quitação), métricas MRR/churn/NFCe. PRD §10.13–10.14 abertas (suspensão automática vs manual; MRR SaaS vs membership).

## Decisão

- UI: `internal-admin/empresas` ganha aba **Operação** (super-admin-only, fora do tenant): tabela subscriptions cross-tenant (inadimplência destacada), botões suspender/retomar tenant (Edge `admin-subscription` → RPC `admin_set_subscription_status` com **motivo obrigatório**, auditado em `subscription_status_changes`; bloqueado → app redireciona quitação — fluxo existente reutilizado), trilha auditoria.
- Motivo obrigatório **no servidor**: suspender (`→ bloqueado`) valida no schema zod da Edge; retomar (`bloqueado → ativo`) valida no handler após carregar o tenant. As demais transições legadas (ex.: `trial → ativo`) mantêm motivo opcional. O dialog legado (`MudarStatusDialog`) espelha a exigência.
- RPCs super-admin-only (**`role = super_admin` OU operador interno ativo** via `is_active_internal_operator()`, mesmo padrão das RPCs internas): `mrr_report()` (SaaS **atual**: tenants ativos por plano do catálogo; snapshot sem mês, sem série histórica), `membership_mrr_churn()` (membership: MRR recorrente + churn canceladas/período), `nfce_volume()` (autorizadas/contingência por período). Decisão §10.14: **duas métricas separadas** (SaaS MRR ≠ membership MRR, nunca somadas).
- Decisão §10.13: suspensão **manual** neste MVP (débito: automação futura).
- Gating: `backofficeT14` (operação/suspender) e `backofficeT15` (métricas) separados; `false`/`null` → seção legível bloqueada ("não incluído"). Falha de rede ao ler o catálogo é estado distinto (`error`): painel "não foi possível verificar" + retry, também com zero request de dados.

## Consequências

- Positivas: T1.4/T1.5 operáveis sem cross-tenant no app tenant; métricas desagregadas evitam duplo-contar.
- Negativas: sem suspensão automática (inadimplente pode operar até ação manual).

## Escopo

- Entra: aba Operação + 4 RPCs + suspender/retomar + gating duplo.
- Não entra: automação cobrança SaaS, app tenant (intocado).

## Arquivos afetados

- `src/internal-admin/empresas/*` (aba Operação/Métricas, tabelas, ações, gating)
- `supabase/migrations/*_backoffice_t14_t15.sql` (4 RPCs + guard super_admin/operador)
- `supabase/functions/admin-subscription/*` (motivo obrigatório em suspender/retomar)
- `src/lib/validations/{admin-subscription,backoffice}.ts` + `MudarStatusDialog` (espelho do motivo obrigatório)

## Critérios de aceite (testáveis)

1. Super admin vê inadimplentes cross-tenant; suspender bloqueia tenant (login → quitação); retomar restaura; ambos auditados com autor/motivo; suspender/retomar sem motivo → 400 e nenhuma escrita.
2. `mrr_report()` devolve MRR SaaS **atual** (`as_of`, sem parâmetro de mês); churn = canceladas/período; `nfce_volume` = autorizadas por período; membership MRR separado do SaaS.
3. Não-super-admin → 403 + RLS nega; gating `false`/`null` → bloqueado legível ("não incluído") sem request; falha de rede → painel "não foi possível verificar" com retry, sem request de dados.
4. Suite verde; **cadeia Fase 5 completa**: NFCe→membership→pagar→receber→conciliação→DRE→export→back-office navegável com screenshots em `harness/`.
