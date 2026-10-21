# ADR-07 — Verificação consolidada: QA do webhook simulado + build/deno check + visual

**Status:** proposto
**Escopo:** ambos (verificação de ponta a ponta; sem código de feature novo)
**Depende de:** adr-01, adr-02, adr-03, adr-04, adr-05, adr-06 (tudo construído)

## Contexto

As ADRs 01–06 entregam schema, cron, webhook de entrada, lembrete, retentativa e frontend. Nenhuma
delas é, sozinha, um fluxo ponta-a-ponta verificável pela UI (migrations e funções SQL/cron são
fundação; o webhook é back-end puro). Esta ADR consolida a verificação exigida pelo PRD §3 e §8,
fechando a fatia antes do PR. **Não** há WhatsApp real nem celular; o webhook é exercitado com
**payload simulado** e o cron/retentativa pela **lógica** (funções SQL), exatamente como o PRD pede.

## Decisão

Roteiro de QA consolidado (sem escrever código de feature — só, se necessário, scripts de teste
descartáveis que são removidos ao final):

1. **Build/typecheck/deno check:** `npm run build`, `npm run typecheck`, `npm run test -- --run` na
   raiz; `deno check` das Edge Functions novas (`whatsapp-inbound` e, se criada, `whatsapp-dispatch`).
   Tudo limpo.

2. **Migrations:** `supabase db reset` (CLI + Docker) aplica tudo, exit 0, duas vezes (idempotência).
   Se CLI/Docker indisponível, **registrar** a limitação (o PRD permite verificação estática do SQL),
   e documentar exatamente o que não foi exercitado.

3. **Webhook `whatsapp-inbound` com payload simulado** (servir funções local; popular um tenant +
   `whatsapp_instances` conectada + `customers` opt-in + `appointments` futuro + `lembrete_d1`
   enviado). Exercitar e registrar evidência:
   - `1` → agendamento vira `confirmado`, `confirmed_via='cliente_whatsapp'`, `confirmed_at`
     carimbado, `webhook_events.status='processado'`/`parsed_intent='confirmar'` (R9).
   - `2` → status inalterado; `messages reagendar_retorno` em `fila`; `parsed_intent='reagendar'`
     (R10/R14).
   - **duplicado** (mesmo `external_event_id`) → uma só `webhook_events`, sem segundo efeito (R7).
   - **inválido/não-autêntico**: sem segredo → `401`/`rejeitado` (R5); corpo fora do zod →
     `400`/`rejeitado` (R6); sem efeito nos dois.
   - texto não reconhecido → `ignorado`/`nao_reconhecido` (R11).
   - **isolamento (R12):** telefone em dois tenants só confirma o do tenant da instância.
   - **transição segura (R13):** `1` para agendamento `cancelado` não derruba a função.
   - **PII (R19):** inspecionar `webhook_events.payload`, `messages.payload` e os logs do
     `functions serve` — sem telefone, sem documento, sem texto cru.

4. **Lembrete D-1 e retentativa (lógica):** `select whatsapp_enqueue_lembrete_d1();` prova R1–R4 e a
   suspensão por assinatura/conexão; `select whatsapp_process_retry_queue();` prova R15–R17 (backoff,
   limite, janela). Registrar as contagens antes/depois.

5. **Frontend (Chrome DevTools MCP):** `cd <worktree> && npm run dev`, navegar a `/app/agenda` com um
   agendamento `confirmed_via='cliente_whatsapp'` e outro `manual`/`null`:
   - confirmar o micro-selo + `aria-label="Confirmado pelo cliente no WhatsApp"` no DOM só no
     primeiro; só o badge no segundo (§8.1/§8.2).
   - navegar a `/app/config/whatsapp` (histórico): rótulos "Lembrete (24h antes)"/"Enviada",
     "Retorno de reagendamento", estados `Na fila`/`Falha` com `title` certos; **nenhuma** PII
     (telefone/texto cru) em tela/DOM/tooltip (§8.3–8.5, §8.9).
   - medir contraste do badge `Confirmado` (≥4,5:1) e do ícone do selo contra `bg-card` (≥3:1) nos
     temas claro e escuro; registrar os números (§8.6).
   - foco/teclado: Tab chega ao bloco com anel visível; selo não cria foco extra (§8.7).
   - mobile ~375px: sem overflow com selo+badge; histórico em cards (§8.8).
   - console sem erros; requisições ao Supabase OK. Parar o dev server ao final.

6. **Segredos (R20):** confirmar que `WHATSAPP_WEBHOOK_SECRET` e token/credenciais da Evolution só
   aparecem em env/`.env.example` (vazio), nunca no bundle (`grep` no `dist/` por prefixo/valor) nem
   em arquivo versionado.

## Consequências

- Fecha os critérios R1–R22 e §8 do PRD com evidência registrada, distinguindo o que foi exercitado
  ao vivo do que ficou verificado estaticamente (envio real pela Evolution com QR pareado continua
  não-exercitável sem celular, como na Fatia 1).
- Qualquer defeito encontrado volta a ADR correspondente ao loop (changes_requested), não ao PR.

## Arquivos afetados

- Nenhum de aplicação. Apenas evidência de QA registrada pelo pipeline (`<adr-id>.qa.json`) e, se
  usados, scripts de teste temporários removidos ao final.

## Critérios de aceite testáveis (desta ADR)

1. Todos os comandos de build/typecheck/test/deno check retornam limpos.
2. Os casos do webhook (1/2/duplicado/inválido/não-autêntico/isolamento/transição segura) produzem
   os estados esperados em `webhook_events`/`appointments`/`messages`.
3. As funções de lembrete e retentativa provam R1–R5 e R15–R17 por chamada manual.
4. O QA visual confirma selo, histórico sem PII, contraste medido, teclado e mobile.
5. Nenhum segredo no bundle/versionado.

## Verificação

- Execução do roteiro acima; evidência em `.agents/tasks/dev-pipeline/adr/adr-07.qa.json`
  (campo `evidence`) e nos vereditos de review. Limpeza de artefatos temporários de teste.
