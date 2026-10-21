# ADR-04 — Job de lembrete D-1 (cron) que enfileira `lembrete_d1` idempotente

**Status:** proposto
**Escopo:** dados (função SQL agendada + agendamento via pg_cron da ADR-02)
**Depende de:** adr-01 (campos de retentativa em `messages`), adr-02 (infra pg_cron condicional)

## Contexto

O valor central da Fatia 2 é o lembrete automático 24h antes (D-1), que hoje não existe. A decisão
da ADR-02 é cron por **função SQL `security definer`**. Esta ADR escreve a função
`whatsapp_enqueue_lembrete_d1()` que o job `atlas_lembrete_d1` chama a cada 15 min.

Fatos consumidos:
- `appointments` (`starts_at timestamptz` UTC, `status`, `tenant_id`), `customers`
  (`whatsapp_opt_in`), `whatsapp_instances` (`connection_status`), `tenants`
  (`subscription_status`, `timezone`).
- `messages`: escrita por privilégio elevado; dedupe por índice único parcial
  `(tenant_id, dedupe_key)`; o `handleSend` usa `dedupe_key = 'lembrete_d1:a:<appointmentId>'`.
- Campos de retentativa (ADR-01): a mensagem enfileirada nasce `status='fila'`, `attempts=0`,
  `next_attempt_at=now()` para o worker (ADR-05) enviar.

### Pontos abertos do PRD §7 resolvidos aqui

- **Janela D-1 = `starts_at` entre `now()+23h` e `now()+25h`** (faixa de 2h, confortável para um
  cron de 15 min). Faixa fixada; ajustável via constante na função.
- O job **só enfileira** (`messages` em `fila`); o envio físico é do worker (ADR-05). Assim o
  lembrete nasce já sujeito a retentativa/backoff e janela útil.

## Decisão

Função `whatsapp_enqueue_lembrete_d1()` (`language plpgsql`, `security definer`, `search_path`
fixo), que num único `insert ... select`:

1. Seleciona agendamentos elegíveis (R1):
   - `status in ('pendente','confirmado')`;
   - `starts_at >= now() + interval '23 hours'` e `starts_at < now() + interval '25 hours'` (R4: no
     passado nunca entra);
   - cliente com `whatsapp_opt_in = true` (R3);
   - tenant com `subscription_status not in ('bloqueado','cancelado')` (suspensão de disparo);
   - instância do tenant `connection_status = 'conectado'`;
   - **sem** `lembrete_d1` prévio para o agendamento: `not exists (select 1 from messages m where
     m.tenant_id = a.tenant_id and m.dedupe_key = 'lembrete_d1:a:' || a.id and m.status in
     ('fila','enviado','entregue'))` (R2 — espelha a semântica do índice parcial).
2. Insere `messages (tenant_id, customer_id, appointment_id, channel='whatsapp',
   template='lembrete_d1', status='fila', dedupe_key='lembrete_d1:a:'||a.id, payload=<sem PII:
   {template, appointment_id}>, attempts=0, next_attempt_at=now())`.
   - **Idempotência real (R2):** o índice único parcial `messages_dedupe_uidx` barra a 2ª inserção
     sob corrida; o `not exists` evita o caso comum. Usar `on conflict do nothing` na coluna do
     índice de dedupe para a dupla execução não levantar erro (duas rodadas seguidas → nada novo).
3. A função é segura para rodar manualmente (teste sem pg_cron): `select
   whatsapp_enqueue_lembrete_d1();` enfileira o que for elegível naquele instante.

O agendamento (`cron.schedule('atlas_lembrete_d1', '*/15 * * * *', $$select
whatsapp_enqueue_lembrete_d1();$$)`) vive no bloco condicional da ADR-02 (ou nesta migration, à
escolha do coder, mantendo a condicionalidade de extensão).

## Consequências

- Lembrete D-1 passa a nascer sozinho, uma vez por agendamento, respeitando opt-in, assinatura,
  conexão e janela. O envio efetivo fica a cargo do worker (ADR-05), uniformizando o caminho.
- A função é determinística e testável sem scheduler — atende o caminho de verificação do PRD §3.
- Reusa a MESMA convenção de `dedupe_key` do `handleSend`, então um `lembrete_d1` enviado sob
  demanda na Fatia 1 e o automático **não** duplicam (mesma chave).

## Arquivos afetados

- `supabase/migrations/20250223095000_fn_lembrete_d1.sql` (novo — função + opcional
  `cron.schedule` condicional).

## Critérios de aceite testáveis (desta ADR)

1. **R1:** com um agendamento `pendente`, opt-in true, instância conectada, tenant ativo,
   `starts_at` a ~24h, `select whatsapp_enqueue_lembrete_d1();` cria **exatamente uma** `messages`
   `lembrete_d1` em `fila`.
2. **R2:** chamar a função duas vezes seguidas não cria um segundo `lembrete_d1` para o mesmo
   agendamento.
3. **R3:** cliente `whatsapp_opt_in=false` → nenhum `lembrete_d1`.
4. **R4:** `starts_at` no passado → nenhum `lembrete_d1`.
5. Tenant `bloqueado`/`cancelado` ou instância não conectada → nenhum `lembrete_d1`.
6. `supabase db reset` aplica a migration limpo (com e sem pg_cron); re-apply idempotente.

## Verificação

- `supabase db reset`, popular dados de teste (tenant ativo + instância conectada + customer opt-in
  + agendamento ~24h), `select whatsapp_enqueue_lembrete_d1();` e inspecionar `messages`. Repetir a
  chamada para provar R2. Variar opt-in/janela/assinatura para R3/R4/R5.
- `npm run build` permanece limpo.
