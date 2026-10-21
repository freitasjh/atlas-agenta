# ADR-04 — Renderização server-side no `handleSend` (Edge Function `whatsapp`)

**Status:** proposto

**Escopo:** dados (Edge Function / superfície privilegiada)

**Depende de:** ADR-01 e ADR-02 (a tabela e o seed precisam existir para o servidor ler o `body`);
ADR-03 (o servidor espelha a lista fechada + tabela de fallback). É o ponto que cumpre o critério de
aceite central (defeito #2/#3).

## Contexto

Hoje, em `supabase/functions/whatsapp/index.ts`, `handleSend` envia **a string crua da chave**:
`adapter.sendText({ ..., text: input.template })` — o cliente final recebe literalmente
`"confirmacao"`. A fatia troca a origem do texto: o servidor carrega o `body` do template do tenant,
resolve as variáveis e envia o **texto renderizado** (RF-T06). A renderização é **100% no servidor**
(decisão D5 — o cliente nunca monta o corpo final; o servidor é a fronteira única de envio, ADR-04
original). Tudo isso **sem mudar o contrato de fio de `send`** (`action|template|customerId|
appointmentId?`) e **sem regredir** os 5 outcomes, opt-in, idempotência e checagem de instância
(RF-T08 / AC-07, defeito #2).

A resolução de dados é sob service role, filtrada por `tenant_id` já derivado do JWT (nunca do
cliente). PII mínima em log permanece: **não** logar o texto renderizado (contém o nome do cliente)
nem o telefone; `messages.payload` continua sem PII (RNF-T02 / AC-08, defeito #4).

## Decisão

Alterar **apenas** `supabase/functions/whatsapp/index.ts` (e, se necessário, um módulo de apoio novo
`supabase/functions/whatsapp/render.ts` para a função de render espelhada — ver abaixo). Dentro de
`handleSend`, **após** as travas atuais (role, tenant, suspensão de assinatura, customer resolvido,
opt-in, idempotência, instância conectada) e **antes** do `adapter.sendText`:

1. **Carregar o body do template:** `select body from message_templates where tenant_id = <tenant> and
   template_key = input.template and active = true` (service role, dentro do tenant resolvido). Se não
   houver linha (tenant legado sem baseline, ou template inativo), usar o **texto de sistema padrão**
   da chave — uma const no servidor com os mesmos 4 textos da ADR-02 — nunca enviar vazio nem a chave
   crua (RF-T07 / §6.4 de `analysis-data.md`).
2. **Resolver as variáveis necessárias** sob service role, dentro do tenant:
   - `{nome}` ← `customers.name` (customer já resolvido no fluxo atual);
   - `{servico}` ← `services.name` via `appointments.service_id`, só quando `input.appointmentId`
     presente;
   - `{dataHora}` ← `appointments.starts_at` formatado no fuso do tenant (`tenants.timezone`, default
     `America/Sao_Paulo`) via `Intl.DateTimeFormat('pt-BR', { timeZone })` (o servidor não importa
     `src/lib/datetime.ts` — reimplementar a formatação mínima em Deno);
   - `{empresa}` ← `tenants.trade_name` (fallback `legal_name`, depois `nossa equipe`).
   - Resolver só o que o `body` referencia (ler o appointment/service apenas se o texto usar
     `{servico}`/`{dataHora}`), mas resolver condicional é otimização; o correto mínimo é resolver os
     dados disponíveis e deixar o fallback cobrir o que faltar.
3. **Renderizar** com a lógica espelhada da ADR-03 (mesma lista fechada + tabela de fallback). Criar
   `supabase/functions/whatsapp/render.ts` com `renderTemplate(body, vars)` idêntico em
   comportamento ao de `src/lib/message-templates.ts` — paridade obrigatória; comentar no topo que a
   fonte canônica é a ADR-03 e que mudanças devem ser espelhadas.
4. `adapter.sendText({ ..., text: <textoRenderizado> })` em vez de `text: input.template`.

Invariantes preservadas (não tocar): opt-in antes de chamar o provedor; `dedupe_key` + índice único
parcial; checagem `connection_status === 'conectado'`; os 5 outcomes com os mesmos status HTTP;
`messages.payload` sem PII (pode seguir registrando `template`/`appointment_id`); logs sem
telefone/texto renderizado.

## Consequências

- O cliente final passa a receber o texto real personalizado — o critério central da fatia.
- O servidor ganha a responsabilidade de resolver `service`/`appointment`/`tenant` no envio (antes só
  resolvia `customer`); custo pequeno, sob service role, dentro do tenant.
- A function passa a depender de `message_templates` existir (ADR-01/02) — o fallback de template
  ausente evita falha dura em tenant legado.
- **Dívida de paridade:** `render.ts` (Deno) espelha `src/lib/message-templates.ts` (app). Documentar
  o vínculo nos dois arquivos; a ADR-03 é a fonte canônica.

## Arquivos afetados

- `supabase/functions/whatsapp/index.ts` (modificar `handleSend`)
- `supabase/functions/whatsapp/render.ts` (novo — render espelhado da ADR-03)

## Critérios de aceite (testáveis nesta ADR)

- **AC-05 (render no envio):** com a instância conectada e um customer com opt-in, disparar
  `confirmacao` cujo `body` é `"Olá {nome}, seu horário de {servico} é {dataHora}."` → o `text`
  entregue ao adapter é o **texto renderizado** (`{nome}/{servico}/{dataHora}` substituídos), **nunca**
  a string `"confirmacao"`. Verificável pelo adapter mock (loga/retorna o que recebeu) e/ou por teste
  da função de render do servidor.
- **AC-06 (fallback):** disparar um template com `{servico}`/`{dataHora}` **sem** `appointmentId` → o
  texto contém os fallbacks pt-BR (`seu atendimento`, `no horário combinado`), nunca `{servico}` cru;
  `{foo}` desconhecido mantido literal.
- **AC-07 (sem regressão):** os 5 outcomes (`sent|duplicate|opt_out|not_connected|send_failed`)
  continuam nas mesmas condições e status HTTP; o contrato de fio de `send` não muda.
- **AC-08 (PII/segredo):** nenhum log imprime telefone nem o texto renderizado em claro; nenhum
  segredo da Evolution em log/resposta.
- Verificar: `npm run typecheck` limpo; função servida localmente (`supabase functions serve whatsapp
  --env-file supabase/functions/.env`) responde aos disparos acima com o texto renderizado (QA ao
  vivo na ADR-07).
