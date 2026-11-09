# Runbook — reconciliação `v_charges_pagas_sem_plano`

A Edge de webhook de assinatura **nunca toca em `tenants.plan`** (decisão G5).
O plano é SSoT em `tenants.plan` e só muda pela Edge `admin-plan` (RPC
`admin_set_tenant_plan`, auditada em `tenant_plan_changes`).

## Quando aparece divergência

A view `v_charges_pagas_sem_plano` lista `subscription_charges` com
`status='pago'` cujo `plan` (intenção da cobrança) difere do `plan` atual do
tenant. Causas comuns: cobrança gerada com plano errado, ou troca de plano
feita depois do pagamento sem gerar nova cobrança.

## Procedimento manual (Fase 1)

1. Abrir `/admin/assinaturas`: o banner ⚠️ mostra a contagem de divergências
   (lida pelo hook `usePlanDivergences` via RPC `admin_get_plan_divergences`).
2. Consultar (somente super_admin; tenant comum recebe `forbidden`):
   ```sql
   select * from public.admin_get_plan_divergences();
   ```
   A view `v_charges_pagas_sem_plano` é `security_invoker` e está revogada
   para `anon`/`authenticated`: select direto nela retorna 0 linhas para
   não-super_admin por desenho. Nunca re-grantar a view ao cliente — o
   único caminho é o RPC.
3. Para cada linha: confirmar com o financeiro qual plano vale.
4. Se o plano do tenant estiver errado: `/admin/empresas` → Trocar plano
   (ou `/admin/tenants/:id/plano`), motivo ≥10 caracteres. Sem override quando
   o uso couber; com double-confirm quando estiver acima do limite.
5. Se a cobrança estiver errada: gerar nova cobrança com o plano correto em
   `/admin/assinaturas` (a paga divergente permanece como intenção histórica;
   nunca editar `subscription_charges.plan` pago à mão — gera nova cobrança).
6. Reconsultar a view: divergência some quando os planos voltam a coincidir.

## O que NÃO fazer

- Nunca `UPDATE tenants.plan` direto pelo cliente (trigger barra sessão
  `authenticated`; RLS nega cross-tenant).
- Nunca deixar webhook tocar `plan` (proibido; reconciliação é manual Fase 1).
- Nunca `GRANT SELECT` na view `v_charges_pagas_sem_plano` para
  `anon`/`authenticated` (hardening C1): o único caminho é o RPC
  `admin_get_plan_divergences` (guard super_admin interno).
- Nunca chamar `tenant_plan_usage()` direto do cliente (hardening C2, sem
  `EXECUTE` para `authenticated`): o único caminho é `admin_get_tenant_plan`.

## TOCTOU conhecido (hardening C3, documentado)

Os triggers `enforce_*_plan_limit` contam-linhas-then-insert sem trava: duas
transações concorrentes podem contar abaixo do teto e inserir juntas
(ultrapassando o limite em 1). `admin_set_tenant_plan` já serializa o
downgrade com `SELECT ... FOR UPDATE` na linha do tenant; os triggers de
criação concorrente não têm essa trava (comportamento Fase 1: fail-closed
no caso sequencial, melhor-esforço no concorrente).

Mitigação prescrita (Fase 3, sem mudar semântica agora):
`pg_advisory_xact_lock(hashtext(tenant_id::text || bucket))` no topo de
`enforce_professional_plan_limit()`, `enforce_appointment_plan_limit()` e do
ramo de downgrade de `admin_set_tenant_plan` — mesma chave lógica, escopo da
transação, sem deadlock entre tenants diferentes.
