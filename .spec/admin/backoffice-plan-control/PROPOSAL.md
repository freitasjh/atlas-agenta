# PROPOSAL — backoffice-plan-control

- Tipo: Feature (backoffice operacional)
- Score prompt gate: consulta inicial + confirmação SDD Fase A+B (1 palavra "sim" → desempate SDD)

## Problema
Plano é só marketing (`plans.ts` + `plans.json` 5900/14900/25900). `tenants.plan` existe (default individual) mas sem write UI/RPC/auditoria. Cobrança PIX manual (`subscription_charges`) não atualiza `tenants.plan`; webhook ativa status mas não plano → divergência. Sem enforcement de limites (1/5/∞ profs, 150 agend/mês Individual). Sem lifecycle automático trial→bloqueado.

## Solução (Fase A+B aprovadas architect + PM)
1. Manter `tenants.plan` como SSoT (não criar tabela `plans` versionada agora).
2. RPC `admin_set_tenant_plan` atômica (FOR UPDATE + audit `tenant_plan_changes`, reason ≥10, super_admin only).
3. Dialog "Trocar plano" em `/admin` (diff limites + motivo obrigatório + preview).
4. Enforcement fail-closed só em create: `can_create_professional` + `can_create_appointment` (Individual 150/mês), erro `PLAN_LIMIT` pt-BR. Downgrade over-limit = grandfather + aviso, nunca delete.
5. Status × plano ortogonais; `charge.desired_plan` + reconciliação manual (webhook nunca escreve plan direto).

## Escopo
- Entra: RPC + audit + Dialog + enforcement create + histórico imutável + upgrade imediato / downgrade próximo ciclo (effective_date fuso tenant).
- Fora: self-service tenant, prorata automática, plano anual, cupons, autoagendamento, taxa reserva, métricas Fase 3.

## Riscos
- Corrida 2 super_admins → FOR UPDATE + 409.
- Divergência charge vs tenant → `desired_plan` + alerta 24h.
- RLS cross-tenant → policy super_admin explícita, tenant_id JWT.
- Downgrade over-limit quebra operação → grandfather + override auditado.

## Delta
- ADDED: `tenant_plan_changes`, RPC `admin_set_tenant_plan`, Dialog Trocar plano, helper `get_tenant_plan`.
- MODIFIED: `EmpresasTable` (ação plano), `AssinaturasPage` (mostrar desired_plan/divergência).
- REMOVED: nenhum.
