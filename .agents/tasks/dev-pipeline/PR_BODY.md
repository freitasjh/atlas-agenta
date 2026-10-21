## Resumo

Entrega a **Fatia 2 do WhatsApp (Fase 2) — confirmação interativa D-1**. Fecha o ciclo do lembrete automático 24h antes com resposta do cliente processada por webhook de ENTRADA da Evolution:

- **Lembrete D-1 automático** enfileirado por job de `pg_cron` (varre agendamentos com `starts_at` na janela 23h–25h, com opt-in, tenant ativo e instância conectada; idempotente por `dedupe_key`; não dispara no passado).
- **Webhook de ENTRADA** (nova Edge Function `whatsapp-inbound`): valida autenticidade por segredo compartilhado (tempo constante), valida o corpo com zod (dado não confiável), é idempotente por `external_event_id`, resolve o tenant **pela instância** (nunca do payload) e casa a resposta ao agendamento certo do tenant certo (telefone E.164 + janela).
- **Resposta "1"** → agendamento vira `confirmado` + `confirmed_via='cliente_whatsapp'` + `confirmed_at` (respeitando a máquina de estados). **Resposta "2"** (decisão **c**) → enfileira mensagem automática `reagendar_retorno` e **NÃO** altera o agendamento (tratamento manual).
- **Fila de retentativa** (`pg_cron`): aplica teto de tentativas (backoff base 5min, fator 3, N=3) e expira a janela útil do lembrete (`janela_vencida`); o envio físico é drenado pela Edge Function `whatsapp-dispatch`.
- **Frontend**: `confirmed_via` nos tipos/select/zod, micro-selo "Confirmado pelo cliente no WhatsApp" na agenda (ícone + `aria-label`, não só cor) e rotulagem do histórico de mensagens.

Entrega sobre `master`. **Não fazer merge sem revisão.** Reusa a Fatia 1 (`message_templates` + render server-side) e o adapter Evolution existente.

## ADRs entregues

- **ADR-01** — Migrations aditivas: `webhook_events` + `appointments.confirmed_via` + campos de retentativa em `messages` + template `reagendar_retorno`
- **ADR-02** — Setup `pg_cron` versionado e condicional (não quebra o `db reset` local)
- **ADR-03** — Edge Function `whatsapp-inbound`: autenticidade + zod + idempotência + casamento resposta→agendamento + efeito 1/2
- **ADR-04** — Job de lembrete D-1 (cron) que enfileira `lembrete_d1` idempotente
- **ADR-05** — Worker de retentativa (cron) com backoff/limite e janela útil + drenadora `whatsapp-dispatch`
- **ADR-06** — Frontend: `confirmed_via` nos tipos/select/zod, selo "confirmado pelo cliente" na agenda e rotulagem do histórico
- **ADR-07** — Verificação consolidada: QA do webhook com payload simulado (1/2/duplicado/inválido) + build/deno check

## Decisões de design

- **Autenticidade do webhook:** a Evolution v2.3.x não assina HMAC por padrão; adotado **segredo compartilhado** (`WHATSAPP_WEBHOOK_SECRET`) apresentado no header `x-webhook-secret`/`apikey` ou query `?token=`, comparado em **tempo constante**. Sem segredo configurado → recusa tudo (falha fechada, 401). Segredo só no servidor, nunca no bundle/`VITE_*`.
- **Idempotência:** chave de dedupe = `external_event_id` (id da mensagem da Evolution) persistido em `webhook_events` **antes** de qualquer efeito; a 2ª gravação viola o índice único e o processamento para (duplicado → sem efeito repetido).
- **Casamento resposta→agendamento:** determinístico — tenant resolvido pela instância; cliente do tenant com `phone` normalizado E.164 == remetente; agendamento `pendente|confirmado` futuro que teve `lembrete_d1` enviado/entregue; escolhe o `starts_at` mais próximo; não casou → `ignorado` (sem efeito).
- **pg_cron:** jobs (`atlas_lembrete_d1` */15, `atlas_retry_queue` */5) registrados em migration condicional que não quebra o `db reset` local quando a extensão não está disponível. As funções SQL são `security definer`, revogadas de papéis de cliente, e **testáveis sem o scheduler**.
- **Retentativa:** separação estado (SQL puro: teto + janela útil) vs envio físico (Edge Function Deno com service role). `reagendar_retorno` não expira por janela (é resposta a pedido do cliente); só o teto de tentativas se aplica.
- **Multi-tenant/RLS:** `webhook_events` com RLS habilitado (SELECT só admin, sem policy de escrita ao cliente); todo efeito carrega o `tenant_id` da própria linha; segredos e operações privilegiadas só em Edge Function/service role.

## O que foi testado

- **Build/typecheck:** `npm run build` (tsc -b + vite build) exit 0 (só o aviso pré-existente de chunk > 500 kB).
- **Testes:** `vitest run` 32/32.
- **Deno check:** `whatsapp-inbound/index.ts` e `whatsapp-dispatch/index.ts` limpos.
- **`supabase db reset`:** aplica as 24 migrations (o caminho condicional do `pg_cron` não quebra o reset local).
- **Webhook inbound ao vivo** (função servida via Deno, segredo de teste, `EVOLUTION_MODE=mock`, payload simulado — sem WhatsApp real):
  - auth inválida → **401** (sem efeito);
  - schema inválido → **400**;
  - resposta **"1"** → **200 processado**, agendamento do tenant A → `confirmado` + `confirmed_via=cliente_whatsapp` + `confirmed_at`; **o mesmo telefone em dois tenants NÃO vazou** (casou só no tenant da instância);
  - **evento duplicado** (mesmo `external_event_id`) → **duplicado**, exatamente **1** evento de confirmação, sem efeito repetido;
  - texto não reconhecido → **ignorado**;
  - resposta **"2"** → **200 processado**, `reagendar_retorno` enfileirado e agendamento **inalterado** (segue `pendente`).
- **Cron D-1 (`whatsapp_enqueue_lembrete_d1()`):** enfileira exatamente **1** para agendamento na janela com opt-in/instância conectada; re-run → **0** (idempotente por `dedupe_key`).
- **Worker de retentativa (`whatsapp_process_retry_queue()`):** teto de tentativas → `falha`/`max_attempts`; lembrete com `starts_at` no passado → `falha`/`janela_vencida`; `reagendar_retorno` não expira por janela; contagem de elegíveis correta.
- **Auditoria de segredos:** `.env` e `supabase/functions/.env` fora do git; só `.env.example` rastreado; nenhum segredo no diff.

## Pendências / notas

- **QA de click-through no navegador (Chrome DevTools MCP) não executado neste step de entrega** — a ferramenta não está exposta a este estágio e o wrapper bloqueia subir o dev server aqui. A integridade do frontend (ADR-06) está coberta pelo build de produção + typecheck limpos, que compilam `AgendaPage`, `AppointmentBlock`, `ClientConfirmedBadge`, `WhatsAppStatusBadge`, `useAppointments` e os tipos de domínio. Recomendo um passe visual manual (contraste AA, foco, mobile ~375px, presença do selo no DOM) antes do merge.
- **pg_cron ao vivo:** os jobs são registrados pela migration, mas o disparo pelo scheduler não foi acionado no teste — a lógica das funções foi provada por SQL (chamada manual). Em prod, confirmar que a extensão `pg_cron` está habilitada no projeto Supabase.
- **Envio real pela Evolution** não exercitado (sem instância pareada / `EVOLUTION_MODE=mock` no QA); a drenadora `whatsapp-dispatch` reusa o adapter da fase anterior.
- Não fazer merge em `master` sem revisão.
