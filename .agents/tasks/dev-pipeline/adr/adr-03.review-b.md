# Revisor B — ADR-03: Edge Function `whatsapp-inbound` (webhook de ENTRADA da Evolution)

Primeiro webhook de ENTRADA do projeto. A função recebe o POST da Evolution quando o cliente
responde ao lembrete D-1, verifica autenticidade por segredo compartilhado em tempo constante,
valida o corpo com zod tolerante, grava `webhook_events` cedo para garantir idempotência,
resolve o tenant **pela instância** (nunca pelo payload), casa a resposta a um agendamento dentro
do tenant e aplica o efeito (`1` confirma / `2` enfileira `reagendar_retorno`). Escopo additivo:
4 arquivos novos/alterados (`index.ts`, `schemas.ts`, `config.toml`, `.env.example`), 688 linhas,
zero edição de código existente.

Watch for: a resolução de tenant e a gravação de idempotência acontecem **antes** da ordem
"auth → schema → idempotência" ser estritamente cumprida (desvio justificado pela coluna
`tenant_id NOT NULL`), o que cria uma janela em que um evento cujo efeito falhou após o INSERT
fica preso em `recebido` e nunca é reprocessado (possible). O casamento carrega **todos** os
`customers` do tenant e normaliza telefone em memória a cada webhook, sem índice (likely,
performance). `deno check` da função **não** pôde ser executado neste ambiente (deno ausente) —
fica para o QA (ADR-07).

**Verdict**: APPROVED

## Visão de alto nível

A postura de autenticidade está correta e fecha-se por padrão: sem `WHATSAPP_WEBHOOK_SECRET`
configurado o webhook recusa tudo com 401, e a comparação é byte a byte sobre o maior
comprimento, sem curto-circuito de tamanho. `verify_jwt = false` está escopado só a
`whatsapp-inbound` no `config.toml`; as demais funções seguem exigindo JWT. Nenhum segredo entra
no bundle — a chave só aparece vazia no `.env.example`.

O isolamento multi-tenant é respeitado na letra do PRD: o `tenant_id` vem sempre de
`whatsapp_instances.evolution_instance_name`, nunca do corpo, e todo o casamento resposta→agendamento
é filtrado por esse tenant. A idempotência de entrada usa a colisão do índice único
`(source, external_event_id)` como trava real, gravando a linha antes de qualquer efeito.

A ordem efetiva do fluxo diverge do enunciado literal da ADR ("auth → schema → idempotência →
efeito"): a resolução do tenant precisa vir antes do INSERT de idempotência porque
`webhook_events.tenant_id` é NOT NULL. O desvio é correto e está documentado, mas abre uma janela
estreita: se o efeito roda e o `finalizeWebhookEvent` falha, uma reentrega colide em 23505 e
retorna "duplicado" sem reprocessar — a linha fica em `recebido`. O efeito de confirmação em si é
idempotente, então o impacto é de auditoria, não de dado.

PII mínima está observada: `webhook_events.payload` guarda só `instance_name`, `event` e
`message_ts`; telefone e texto cru vivem apenas em memória e nenhum `console.error` os ecoa. O
tratamento de transição inválida (23514) para agendamento já cancelado/concluído captura o erro e
registra sem quebrar (R13). Opt-in é respeitado antes de enfileirar `reagendar_retorno` (R14).

O ponto de atenção não-bloqueante é performance: `matchAppointment` busca todos os clientes do
tenant e normaliza cada telefone no app para casar o remetente, o que não escala e não usa índice.
Funciona e é determinístico; vale registrar como dívida.

<details>
<summary>Issues (4)</summary>

1. **Janela de efeito não-idempotente após INSERT (possible)** — se `finalizeWebhookEvent` falhar
   depois do efeito aplicado, a reentrega do mesmo `external_event_id` colide em 23505 e retorna
   "duplicado" sem reprocessar; a linha fica presa em `recebido`. Impacto é de auditoria (o
   confirm é idempotente). Considerar finalizar o evento na mesma transação do efeito ou um
   varredor que reconcilie linhas `recebido` antigas. Não bloqueia.
2. **Casamento O(N) sem índice (likely, performance)** — `matchAppointment` carrega todos os
   `customers` do tenant e normaliza telefone em memória a cada webhook. Para tenants grandes é
   custoso e não indexável. Avaliar coluna de telefone normalizado persistida + filtro no banco em
   fatia futura. Não bloqueia nesta fatia.
3. **`deno check` não executado (confirmed, limitação de ambiente)** — deno não está instalado
   aqui; só `npm run build`/`npm run test`/`tsc` rodaram. A verificação do bundle Deno e o QA com
   payload simulado (1/2/duplicado/inválido) ficam para ADR-07. Garantir que o QA cubra isso.
4. **Contrato do payload Evolution a confirmar (confirmed, já previsto)** — nomes de campo
   (`conversation`/`extendedTextMessage.text`, `data.key.id/remoteJid/fromMe`) vêm de issues
   públicas, não da doc v2.3.7. O zod é tolerante (`.passthrough()`), mas o QA precisa validar
   contra o servidor real e ajustar se divergir. Previsto na ADR.

</details>

<details>
<summary>Details</summary>

### Autenticidade e postura pública (R5, R20)

A comparação de segredo é feita em `timingSafeEqual`, que percorre o maior dos dois comprimentos
acumulando diferença em OR — não há retorno antecipado por tamanho, o que fecha o vetor de timing
por comprimento. A falha é fechada: sem `WHATSAPP_WEBHOOK_SECRET` no servidor o handler responde
401 sem ler o corpo, e o comentário deixa explícito que não vaza configuração. O segredo é lido de
três origens aceitas (`x-webhook-secret`, `apikey`, `?token=`), cobrindo as formas que a Evolution
permite registrar na borda.

O `config.toml` isola `verify_jwt = false` à função `whatsapp-inbound`; nenhuma outra função perde
JWT. O `.env.example` adiciona `WHATSAPP_WEBHOOK_SECRET=` vazio, sem prefixo `VITE_`, então o
segredo nunca cruza para o cliente (R20). A escolha de não persistir `webhook_events` em falha de
auth/schema (porque `tenant_id` só sai da instância, lida depois) é um compromisso documentado na
ADR e no código: o atacante sem segredo não produz efeito nem linha forjável, mas uma rajada de
POSTs rejeitados não deixa rastro em `webhook_events` — a auditoria de tentativas inválidas fica só
no log do servidor.

### Ordem do fluxo e janela de idempotência (R7)

A ADR enuncia "auth → schema → idempotência → resolução/efeito", mas `webhook_events.tenant_id` é
NOT NULL e só se resolve pela instância, então o código faz, na prática, auth → schema → fromMe →
resolve-tenant → INSERT idempotência → efeito. O desvio é necessário e correto.

O ponto a registrar: a linha é inserida como `recebido` e o desfecho é gravado por um
`finalizeWebhookEvent` separado, depois do efeito. Se o processo cair entre o efeito e o finalize,
uma reentrega do mesmo evento colide no índice único e retorna cedo com "duplicado", sem
reprocessar — a linha permanece `recebido`. Como `applyConfirm` já trata o estado `confirmado`
sem reentrar no trigger, não há dupla confirmação; o prejuízo é só auditoria presa em `recebido`.
Fechar a janela pediria finalizar na mesma operação do efeito (ou um reconciliador). Não bloqueia.

### Isolamento multi-tenant e casamento (R8/R12)

O `tenant_id` vem exclusivamente de `whatsapp_instances.evolution_instance_name`, e instância órfã
resulta em 200/`ignorado` sem efeito. Todo o casamento em `matchAppointment` filtra por `tenant_id`
nas três consultas (`customers`, `appointments`, `messages`), então o telefone presente em dois
tenants nunca confirma o do outro tenant (R12). O candidato escolhido é o agendamento futuro, em
estado `pendente`/`confirmado`, com `lembrete_d1` enviado/entregue, de `starts_at` mais próximo
(R8).

A dívida é de forma, não de correção: a função busca **todos** os clientes do tenant e normaliza
cada `phone` em memória para comparar com o remetente normalizado. É O(N) por webhook e não usa
índice. Para tenants com muitos clientes isso pesa; cabe uma coluna de telefone normalizado
indexada numa fatia futura. Determinístico e correto hoje.

### Efeito de confirmação e transição segura (R9/R13)

O caminho `pendente/confirmado → confirmado` faz `update set status='confirmado',
confirmed_via='cliente_whatsapp'` numa só instrução. O trigger `appointments_transition_guard`
dispara em `before update of status`, valida a transição e carimba `confirmed_at` quando nulo;
`confirmed_via` passa junto sem o trigger tocá-lo. Rastreei o trigger (20250219093000) e o CHECK de
`confirmed_via` (20250223091000): o par é coerente. Transição inválida (agendamento já
cancelado/concluído entre o casamento e o update) levanta 23514, capturado por código e registrado
como `processado`/`transicao_invalida` sem 500 (R13). A reconfirmação (`status` já `confirmado`)
atualiza só a origem com `neq('confirmed_via','cliente_whatsapp')`, sem reentrar no trigger — evita
reescrever `confirmed_at`.

### Reagendar e opt-in (R10/R14)

`enqueueReagendarRetorno` não altera `appointments` — só enfileira `messages` com
`template='reagendar_retorno'`, `status='fila'`, `dedupe_key='reagendar_retorno:a:<id>'`,
`attempts=0`, `next_attempt_at=now()`. Confirmei que o CHECK de `messages.template` foi estendido
para aceitar `reagendar_retorno` (migration 20250223093000); sem isso o insert quebraria. Opt-in é
respeitado: sem consentimento grava `status='falha'`/`opt_in_ausente` e não enfileira, espelhando o
`handleSend` da Fatia 1. A idempotência de envio é checada por `dedupe_key` em estados vivos antes
do insert, e a corrida 23505 é tratada como inócua. O envio real fica a cargo do worker (ADR-05),
decisão registrada na ADR.

### PII e schema tolerante (R19, R6)

O `payload` de `webhook_events` carrega só `instance_name`, `event` e `message_ts`; o telefone do
remetente e o texto digitado existem apenas em variáveis locais e nenhum `console.error` os
imprime. `extractSenderNumber` descarta grupos (`@g.us`) e `extractInboundText` tolera
`conversation` e `extendedTextMessage.text`, retornando null quando não há texto (mídia → ignorado).
O `inboundEventSchema` valida o mínimo (`instance`, `data.key.id`) e usa `.passthrough()` em todos
os níveis, rejeitando corpo malformado com 400 sem efeito (R6) e aceitando campos extras da
Evolution. O conteúdo recebido nunca é executado.

</details>

<details>
<summary>Arquivos no escopo da ADR-03 (c2867ad)</summary>

- `supabase/functions/whatsapp-inbound/index.ts` — entrypoint HTTP e lógica do fluxo (novo).
- `supabase/functions/whatsapp-inbound/schemas.ts` — zod tolerante do payload + helpers de
  extração/intenção (novo).
- `supabase/config.toml` — `[functions.whatsapp-inbound] verify_jwt = false` (escopado).
- `supabase/functions/.env.example` — `WHATSAPP_WEBHOOK_SECRET=` vazio.

Contraprova executada: `npm run build` (tsc -b + vite) limpo; `npm run test` (vitest, 32 testes)
verde; `tsc` exclui `supabase/` (só `src` no `tsconfig.app.json`). `deno check` não executável
aqui (deno ausente) — fica para o QA/ADR-07.

Diff completo do escopo: `git diff 07e8692 c2867ad`.

</details>
