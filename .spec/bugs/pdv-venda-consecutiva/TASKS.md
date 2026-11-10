# BUG — pdv-venda-consecutiva (Bugfix fast-track)

Branch: `fix/pdv-venda-consecutiva` (base `fix/pdv-checkout-anonimo`, PR #53 — dependência declarada no PR).
Escopo aprovado pelo usuário: correção da constraint de exclusão (2a) + reset completo do formulário (1a).

---

## Bug 1 (crítico) — 500 `INTERNAL` na venda seguinte do PDV

Segunda venda walk-in para o mesmo profissional devolve
`{"code":"INTERNAL","message":"Erro interno."}`. A primeira venda concluída continua
ocupando o intervalo `[starts_at, ends_at)` na constraint de exclusão.

### Causa raiz (provada no banco local)

```
venda anterior: origin=walk_in status=concluido starts_at=2026-11-10 00:27:21 ends_at=00:57:21
nova venda:     INSERT ... now(), now()+30min
ERROR: conflicting key value violates exclusion constraint "appointments_no_overlap"
       ([00:35:39, 01:05:39]) conflicts with existing key ([00:27:21, 00:57:21])
```

- `supabase/migrations/20250219092000_appointments_no_overlap.sql:41-47` — a constraint
  exclui só `status in ('cancelado','nao_compareceu')`; `concluido` continua indexado.
  Ela foi escrita para **agendamento** (ADR-03/RF06), antes de `origin` existir
  (`20261111000000_walk_in_appointments.sql`). Venda de balcão não é reserva de agenda.
- `supabase/functions/_shared/http.ts:68-75` — `mapRpcError` só traduz `PT\d{3}` com
  `message` = código. SQLSTATE `23P01` cai no fallback `new ApiError(500, "INTERNAL")`.
- `supabase/functions/create-walk-in/handler.ts:94` — `throw mapRpcError(rpcError)`
  propaga o 500 até o `errorResponse`.

### Solução

1. **Migration nova** `supabase/migrations/20261112090000_appointments_no_overlap_origin.sql`
   (timestamp > `20261111000000`, aditiva e idempotente): recria `appointments_no_overlap`
   restringindo a `origin = 'agendado'`, mantendo `status not in ('cancelado','nao_compareceu')`.
   Preserva `btree_gist`, `tenant_id`, `professional_id` e `tstzrange(...)` `[)`.
   `drop constraint if exists` + bloco `pg_constraint` — `db reset` re-executável.
2. **`supabase/functions/_shared/http.ts`** — `mapRpcError` mapeia `23P01` para
   `ApiError(409, "SLOT_CONFLICT")`; `DOMAIN_MESSAGES.SLOT_CONFLICT` com texto pt-BR.
3. **Front** — `src/lib/payment-errors.ts` ganha `SLOT_CONFLICT`; catálogo
   `src/app/agenda/pagamentos/payments-messages.ts` ganha `error.slotConflict`;
   `src/lib/scheduling-errors.ts` reconhece `SLOT_CONFLICT`; `PdvPage` passa a exibir a
   mensagem própria (não cai em "Erro interno").

---

## Bug 2 — formulário não é limpo após concluir a venda

`src/app/pdv/PdvPage.tsx` — `onCompleted` do `PaymentCaptureDialog` só fecha o diálogo e
refaz a lista. Profissional/serviço/cliente da venda anterior permanecem no formulário,
risco de venda com dados errados e de reuso de `customer_id`.

### Solução (decisão 1a: limpar tudo)

No `onCompleted`, `form.reset(initialValues(ownProfessional?.id ?? ""))` +
`setIdentify(false)` + `form.clearErrors()`:

- `professionalId` → `""` (ou o próprio profissional, quando papel `professional`);
- `selection` → `{ kind: "service", serviceId: "" }`;
- `customerName` / `customerPhone` → `""`;
- `whatsappOptIn` → `false`;
- `identify` → `false` (campos ocultos).

`ownProfessional` é reaplicado: `useEffect` preenche `professionalId` com o profissional
do usuário quando o papel é `professional` (Select travado), e o reset repopula esse id —
o operador `professional` nunca fica com campo vazio e inválido. O refetch de
"A concluir hoje" é mantido.

---

## Testes

- Unit (Deno): `supabase/functions/_shared/http.test.ts` — `mapRpcError` traduz `23P01`
  para 409 `SLOT_CONFLICT` (não INTERNAL); `PT4xx` continua mapeado.
- Unit (Deno): `supabase/functions/create-walk-in/handler.test.ts` — RPC devolvendo
  `23P01` resulta em HTTP 409 + `code: SLOT_CONFLICT`.
- Unit (Vitest): `src/app/pdv/PdvPage.test.tsx` — após concluir a venda, todos os campos
  voltam ao inicial (identify falso, campos ocultos vazios, profissional/serviço
  invalidados); papel `professional` repopula o próprio id.
- Integração: duas vendas walk-in consecutivas para o mesmo profissional, dentro da
  duração do serviço → ambas 201 na Edge + pagamento 200, sem `23P01`.
- Integração: agendado continua protegido — dois agendamentos sobrepostos violam `23P01`.
- Integração: o erro real `23P01` entre agendados é traduzido pelo contrato HTTP em
  409 `SLOT_CONFLICT` (não 500).

## Riscos

- Migration mexe em constraint de integridade de agenda: o `where` restringe a
  `origin = 'agendado'`; agendados seguem protegidos (coberto por teste de integração).
  `db reset` 2× valida idempotência.
- RLS/trigger/policy intocados. Nenhum `.skip`/`.todo`.
- Reset do form não pode zerar o profissional travado (papel `professional`): coberto por
  teste de repopulação.

## Arquivos + impacto

- `supabase/migrations/20261112090000_appointments_no_overlap_origin.sql` (novo)
- `supabase/functions/_shared/http.ts` (+ teste novo)
- `supabase/functions/create-walk-in/handler.test.ts`
- `src/lib/payment-errors.ts`
- `src/app/agenda/pagamentos/payments-messages.ts`
- `src/lib/scheduling-errors.ts`
- `src/app/pdv/PdvPage.tsx` (+ teste)
- `tests/integration/security/pdv-walk-in.test.ts`
- `tsconfig.integration.json` (inclui `_shared/http.ts` para o teste de contrato)
