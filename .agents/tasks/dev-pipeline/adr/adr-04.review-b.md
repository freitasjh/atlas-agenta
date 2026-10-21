# Review B (v2) — ADR-04: função `whatsapp_enqueue_lembrete_d1()` (cron D-1)

Segundo passe. O passe anterior (v1) bloqueou com um único achado: cliente soft-deleted (`customers.active = false`) ainda recebia o lembrete D-1, divergindo do precedente explícito do `handleSend` da Fatia 1. O coder respondeu com o commit `0790761` ("fix: excluir cliente inativo do lembrete D-1"), que adiciona `and c.active = true` à CTE `eligible` de `supabase/migrations/20250223095000_fn_lembrete_d1.sql`. Reli o arquivo do disco, confirmei o precedente e rodei a contraprova. O bloqueio está resolvido e nenhum concern novo surgiu.

**Watch for:** nada bloqueante. Permanecem duas notas informativas de v1 (sem índice para a varredura por janela `starts_at`; o `atlas_retry_queue` aponta para função da ADR-05 ainda inexistente), ambas fora do escopo desta ADR.

**Verdict**: APPROVED

## Visão de alto nível

O escopo do diff desta ADR continua sendo um único arquivo SQL (`20250223095000_fn_lembrete_d1.sql`, +148 linhas) sobre a base `c2867ad` (HEAD da cadeia adr-03): a função `security definer` que o cron chama a cada 15 min para enfileirar `lembrete_d1` idempotente. Nada de TS/frontend.

A correção pedida está aplicada e verificada contra o precedente. A linha `and c.active = true` entra na CTE `eligible` entre a janela D-1 e o filtro de opt-in, com comentário que aponta para a origem da regra (`supabase/functions/whatsapp/index.ts`). Reli `index.ts:381-382` — o `handleSend` rejeita `customer.active === false` com a mesma justificativa — e a coluna `customers.active bool not null default true` (`20250219...customers`, convenção P5 de soft-delete). As duas camadas de disparo agora tratam cliente inativo igual.

O restante do desenho (validado em v1 e inalterado) permanece sólido: idempotência dupla (`not exists` + `on conflict` inferindo exatamente o índice parcial `messages_dedupe_uidx`), `tenant_id` carregado de cada candidato (cron não cruza tenants), `revoke` de `public/authenticated/anon`, payload PII-mínima (`{template, appointment_id}`), nenhum segredo no SQL. Elegibilidade cobre status, janela 23h–25h, opt-in, assinatura e conexão da instância — agora também `active`.

<details>
<summary>Issues (2)</summary>

1. **Sem índice para a varredura por janela (menor, informativo)** — o filtro `starts_at` entre `now()+23h` e `now()+25h` não tem índice direto; `appointments_tenant_professional_starts_idx (tenant_id, professional_id, starts_at)` não ajuda sem `professional_id` na predicada. Aceitável no volume por tenant do MVP; registrar como nota de performance se o número de agendamentos crescer. Possível, fora do escopo desta ADR.
2. **`atlas_retry_queue` aponta para função da ADR-05 ainda inexistente (informativo, fora de escopo)** — o job registrado na ADR-02 referencia `whatsapp_process_retry_queue()`; o `cron.schedule` guarda a string e o job fica inerte até a ADR-05 definir a função. Não é desta ADR.

</details>

<details>
<summary>Details</summary>

## A correção do bloqueio v1 (verificada)

O diff do commit de correção é cirúrgico:

```sql
      and a.starts_at <  now() + v_window_end
+      -- Cliente ativo: soft-delete (active = false) não recebe disparo — mesma semântica do
+      -- handleSend sob demanda da Fatia 1 (supabase/functions/whatsapp/index.ts).
+      and c.active = true
       -- Consentimento LGPD explícito (R3).
       and c.whatsapp_opt_in = true
```

A CTE já fazia `join public.customers c on c.tenant_id = a.tenant_id and c.id = a.customer_id`, então o predicado `c.active = true` cai direto no `where` sem alterar a junção. Precedente confirmado em `supabase/functions/whatsapp/index.ts`:

```ts
// Cliente inativo (soft-delete) não recebe disparo — coerente com a semântica de `active`.
if (customer.active === false) {
  return errorResponse("Cliente inativo não pode receber mensagens.", 404);
}
```

Como o lembrete D-1 é disparo ao cliente final igual ao envio sob demanda, a regra agora é a mesma nas duas camadas. Não havia como o cliente inativo ser filtrado por outro caminho (o opt-in e o soft-delete são colunas independentes de `customers`), então a adição era de fato necessária.

## Idempotência e isolamento (reconfirmado, inalterado desde v1)

O predicado do `on conflict (tenant_id, dedupe_key) where status in ('fila','enviado','entregue')` é idêntico ao predicado do índice parcial real:

```
CREATE UNIQUE INDEX messages_dedupe_uidx ON public.messages USING btree (tenant_id, dedupe_key)
  WHERE (status = ANY (ARRAY['fila'::text, 'enviado'::text, 'entregue'::text]))
```

então a inferência do árbitro resolve sem ambiguidade para `messages_dedupe_uidx` — se os predicados divergissem, o `on conflict` levantaria "no unique or exclusion constraint matching". A `dedupe_key` (`lembrete_d1:a:<id>`) reusa a convenção da Fatia 1, então lembrete sob demanda e automático não duplicam.

## Contraprova (v2)

- `npm run typecheck` → exit 0.
- `npm run build` → exit 0 (warning de chunk > 500 kB é pré-existente, não introduzido aqui).
- `npm run test` (vitest) → 32/32 passam.

ADR SQL-only: build/test não exercitam a função, mas confirmam ausência de regressão. A verificação funcional forte (R1–R5 em transação com `rollback`, incluindo o caso `active = false` que agora retorna 0) foi feita no passe v1; a única mudança desde então é a linha `active = true`, cuja semântica está verificada contra o precedente acima. O QA ao vivo do webhook e cenários combinados ficam para a ADR-07, conforme o pipeline.

</details>

<details>
<summary>Arquivos no escopo</summary>

- `supabase/migrations/20250223095000_fn_lembrete_d1.sql` (novo, +148) — define `whatsapp_enqueue_lembrete_d1()`; sem `cron.schedule` (o agendamento vive na ADR-02). Ordem de timestamp correta (após `094000`).

Diff do escopo: `git diff c2867ad HEAD -- supabase/ src/`. Commit da correção v1→v2: `0790761`.

</details>
