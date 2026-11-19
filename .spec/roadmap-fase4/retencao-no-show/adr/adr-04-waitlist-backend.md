# ADR-04 — Waitlist (B): backend (tabela, fila, oferta, idempotência)

- Status: proposto

## Contexto

Capacidade B exige lista de espera por serviço/profissional, inclusão a partir de slot ocupado, oferta automática com countdown, Confirmar/Recusar e gestão manual (RF-07..RF-11). Backend mínimo: tabela `waitlist_entries` + RPCs de fila/oferta. Deve respeitar RBAC, opt-in, idempotência e gating.

## Decisão

1. Tabela `waitlist_entries`:
   - `id`, `tenant_id`, `customer_id`, `service_id`, `professional_id` (nullable), `desired_start_from`, `desired_start_to` (timestamptz), `priority int default 0`, `status text check (status in ('waiting','offered','confirmed','declined','expired','attended','cancelled'))`, `offered_slot_start/end`, `offer_expires_at`, `offered_appointment_id`, `created_by`, `created_at`, `updated_at`.
   - FKs compostas por tenant; índices por tenant/serviço/status/prioridade/validade.
   - RLS: admin/receptionist leem/escrevem todos do tenant; professional lê apenas próprios clientes? (decisão: professional vê próprias entradas vinculadas a seus clientes; sem financeiro).
2. RPCs:
   - `waitlist_enqueue(...)` idempotente por tenant+customer+service+período (evita duplicata ativa).
   - `waitlist_offer_next(released_slot...)` seleciona primeiro elegível (prioridade desc, created_at asc, validade), cria oferta com `offer_expires_at = now() + countdown_minutes`, envia WhatsApp se opt-in.
   - `waitlist_confirm(entry_id)` cria appointment no slot ofertado (valida disponibilidade/anti-sobreposição) e marca `confirmed`.
   - `waitlist_decline/expire(entry_id)` marca status e chama `waitlist_offer_next` para o próximo.
   - `waitlist_reorder/remove/mark_attended` para gestão manual com auditoria.
3. Gatilhos de oferta automática:
   - Cancelamento/no-show de appointment libera slot → chama `waitlist_offer_next` para serviço/profissional/período.
   - Expiração de oferta (job/lazy) passa ao próximo.
4. Idempotência por chave de evento (appointment cancelado) e status terminal; replay não duplica oferta/appointment.
5. LGPD/opt-in: oferta via WhatsApp exige `whatsapp_opt_in`; sem opt-in, oferta fica disponível na UI e conta como "excluído por opt-in" nas métricas de campanha? (métricas de waitlist separadas).

## Consequências

- Positivas: reaproveita slots; fila auditável; automação com fallback manual.
- Negativas/risco: concorrência na confirmação (mitigar com transação/lock e validação de disponibilidade); countdown padrão a definir (pergunta 5); waitlist pública a definir (pergunta 4).
- Defaults PRD §7: RLS tenant, UTC.

## Escopo

Entra: migration, RPCs, triggers, testes RLS/idempotência. Não entra: UI, campanhas/fidelidade, motor de notificação fora do existente.

## Arquivos afetados

- `supabase/migrations/<timestamp>_waitlist_entries.sql`
- `supabase/migrations/<timestamp>_waitlist_rpcs.sql`
- Testes de integração (`waitlist_*_IT`)

## Critérios de aceite (testáveis)

1. Enfileiramento idempotente não cria duplicata ativa.
2. Slot liberado gera oferta ao primeiro elegível com countdown.
3. Confirmar cria appointment válido; recusar/expirar passa ao próximo.
4. Gestão manual (reordenar/remover/marcar) atualiza estado com auditoria.
5. Sem entitlement `waitlist`, RPC/UI bloqueados e nenhuma escrita (gating + RLS de rota).
6. RLS impede cross-tenant e professional vê apenas próprios clientes (conforme decisão).

## Dependência

- ADR-01 (gating `waitlist`)
- ADR-02 (status/cancelamento de appointment libera slot)
