# BUG — pdv-checkout-anonimo (Bugfix fast-track)

## Bug 1 (crítico) — finalizar pagamento de venda anônima devolve 500 INTERNAL

`{"code":"INTERNAL","message":"Erro interno."}` no diálogo de fechamento ao abrir o
settlement de uma venda walk-in sem cliente (e também de venda por combo).

### Causa raiz

`supabase/functions/_shared/payments.ts:125-157` — `loadSettlement()` monta as consultas
auxiliares em `Promise.all` sem guarda de null:

- `:127-132` consulta `customers` com `.eq("id", appointment.customer_id)`; `customer_id`
  é NULL em walk-in anônimo (migration `20261111000000_walk_in_appointments.sql:31`
  removeu o `not null`).
- `:133-138` consulta `services` com `.eq("id", appointment.service_id)`; `service_id`
  é NULL quando a venda é por combo (XOR `service_id`/`combo_id`).

`supabase-js` serializa `.eq("id", null)` como `id=eq.null`; o PostgREST responde 400
`22P02` (`invalid input syntax for type uuid: "null"`). O laço `:159-167` trata
`result.error` como `throw new ApiError(500, "INTERNAL")` → dialog mostra "Erro interno.".

Prova empírica contra o stack local:

```
GET /rest/v1/customers?select=name&id=eq.null              -> 400 {"code":"22P02"}
GET /rest/v1/customers?select=name&id=eq.00000000-...-0000 -> 200 []
```

### Solução

Guarda de null antes da query (mesmo padrão de
`supabase/functions/register-appointment-payments/handler.ts:355-364`): id nulo ⇒ pular a
query e usar `{ data: null, error: null }`. Nunca construir filtro com id nulo.

Varredura do mesmo padrão em `supabase/functions/**`:

- `_shared/payments.ts` (customer_id, service_id) — corrigido.
- `create-charge/handler.ts:288-293` (`attachGatewayData`) recebe
  `appointment.customer_id as string` (`:168`), que pode ser NULL em walk-in anônimo →
  mesma falha `22P02` → 500. Corrigido: parâmetro `string | null`, consulta pulada e
  `externalReference` de fallback `walkin:<appointmentId>` (mesmo padrão do
  register-appointment-payments).
- Demais `.eq` com alvo nullable revisados e **não** alterados por nunca receberem null:
  `messages.customer_id` é `not null` (`20250220091000_messages.sql:57`);
  `professionals`/`appointments.id`/`tenant_id`/`profile_id` são não nulos;
  `register-appointment-payments` já tem a guarda.

## Bug 2 — checkbox "Identificar cliente" não abre os campos no PDV

`src/app/pdv/PdvPage.tsx:316-328` — `checked` derivado de `customerName`/`customerPhone`
e `onCheckedChange` só limpa ao desmarcar. Marcar não escreve nada → os inputs de
nome/telefone (`:329`) nunca renderizam.

### Solução

Estado explícito `identify` (`useState<boolean>`), checkbox controlado por ele; ao marcar
os campos aparecem; ao desmarcar limpa nome/telefone e volta ao estado anônimo.
`Label`/`htmlFor` existentes são mantidos (foco alcançável nos inputs).

## Bug 3 — mensagem enganosa no catch da criação da venda

`src/app/pdv/PdvPage.tsx:189-199` — `error.code === "INTERNAL"` era enviado a
`mapSchedulingError`, que não é erro de agenda e devolve "Não foi possível salvar.".
Confirmado: a Edge **não** mapeia `23P01` (`_shared/http.ts:68-75` só traduz `PT4xx`;
`23P01` vira `500 INTERNAL`), logo não existe código real de conflito de agenda chegando
ao frontend. Correção: usar `paymentErrorMessage` para códigos conhecidos e
`messages.pdv.createdError` como fallback; `mapSchedulingError` deixa de ser usado aqui.

**Observação (não corrigida neste escopo):** o `mapRpcError` da Edge transforma o
`23P01` (corrida de dois walk-ins no mesmo slot) em `INTERNAL`. Mapear `23P01` para um
código estável exigiria mudar o contrato de erro da Edge — fora do escopo deste bugfix.

## Arquivos + impacto

- `supabase/functions/_shared/payments.ts` — guarda de null em `loadSettlement`.
- `supabase/functions/create-charge/handler.ts` — guarda de null em `attachGatewayData`.
- `src/app/pdv/PdvPage.tsx` — estado `identify` + correção do catch.
- `supabase/functions/_shared/payments.test.ts` (Deno) — unit de `loadSettlement` com
  `customer_id`/`service_id` nulos: nenhuma query com id null e nomes `null`.
- `src/app/pdv/PdvPage.test.tsx` — marcar identifica e mostra campos; desmarcar limpa.
- `tests/integration/security/settlement-anonymous.test.ts` — settlement de walk-in
  anônimo e de combo responde 200 (não 500 INTERNAL).
- `harness/pdv-checkout-anonimo.json` + `.spec/bugs/pdv-checkout-anonimo/harness/` —
  evidência H3.

Sem migration, sem alteração de RLS/trigger/guard.

## Testes

- Unit (Deno): `loadSettlement` não chama `.eq` com id nulo e devolve
  `customer_name: null` / `service_name: null`.
- Unit (Vitest): `PdvPage` — checkbox controla a visibilidade dos campos e limpa ao
  desmarcar.
- Integração (PostgreSQL real + Edge via HTTP): `get-appointment-settlement` de walk-in
  anônimo e de combo → 200 com `customer_name`/`service_name` nulos.
- Harness H3: browser real em `/app/pdv` — marcar/desmarcar identificação, criar venda
  anônima, abrir pagamento (Network sem 500, Console sem erros) e concluir em dinheiro.

## Riscos

- Regressão no caminho de settlement com cliente/serviço preenchidos — coberto pelos
  testes existentes de `get-appointment-settlement` (302 de integração) e pelo novo caso
  de combo.
- `create-charge` para walk-in anônimo passa a criar cliente Asaas com
  `externalReference` `walkin:<appointmentId>` — sem PII sintética no banco.
- Nenhum afrouxamento de RLS/trigger/policy; nenhum teste desabilitado.
