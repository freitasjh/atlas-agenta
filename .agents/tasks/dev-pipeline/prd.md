# PRD — Fatia 2 do WhatsApp (Fase 2): Confirmação interativa D-1

> **Status:** aguardando aprovação humana (`prd-approval.json → "pending"`).
> **Tipo de rota:** Feature (pesada — primeira vez que o projeto tem webhook de ENTRADA
> da Evolution e job agendado via pg_cron).
> **Base:** `master` (já contém a Fatia 1: `message_templates` + render server-side no
> `handleSend`; `lembrete_d1` já traz o texto "Responda 1 para confirmar ou 2 para reagendar").
> **Entrega:** branch nova + commit; **sem** merge em master (o usuário abre PR/merge).

Este PRD é o **contrato** da demanda: descreve O QUE precisa existir e COMO se prova que
ficou pronto. O desenho técnico detalhado (desenho do webhook, backoff, invocação do cron,
nomes de migration) vem nas ADRs do planejamento, após a aprovação humana deste documento.

---

## 1. Problema e valor de negócio

Hoje o Atlas Agenda só dispara WhatsApp **sob demanda** (Fatia 1). O objetivo central do
produto — **reduzir no-show** com confirmação interativa automática 24h antes (D-1,
`produto.md`) — ainda não existe de ponta a ponta: o texto do lembrete já menciona "responda
1 ou 2", mas nada dispara esse lembrete sozinho nem escuta a resposta do cliente.

Quando esta fatia estiver pronta:

- **A empresa (tenant)** passa a ter o lembrete D-1 disparado automaticamente, sem ninguém
  clicar. O cliente responde **1** no próprio WhatsApp e o agendamento vira `confirmado`
  sozinho. Isso reduz no-show e reduz trabalho manual da recepção.
- **A recepção** ganha visibilidade: a agenda distingue um agendamento confirmado **pelo
  próprio cliente** (prova de intenção) de um confirmado manualmente. Essa distinção é o
  valor de negócio visível da fatia.
- **O cliente que quer reagendar** responde **2** e recebe uma mensagem automática de retorno
  ("entramos em contato para reagendar"); o reagendamento em si continua manual (decisão do
  usuário, opção "c").
- **Resiliência:** uma falha temporária de envio não perde a mensagem — há fila de
  retentativa com backoff e limite, respeitando a janela útil do lembrete.

---

## 2. Escopo

### 2.1 Dados / Supabase (peso principal)

**Entra:**

- **Migrations aditivas** (nunca editar migration já aplicada):
  - Nova tabela **`webhook_events`** (idempotência + auditoria de entrada): `tenant_id`,
    `external_event_id` (chave de dedupe), `instance_name`, `status`, `appointment_id`,
    `parsed_intent`, `payload` sem PII, `failure_reason`, `created_at`. Índice único
    `(source, external_event_id)`. RLS habilitado.
  - **`messages`** ganha campos de retentativa: `attempts`, `max_attempts`, `next_attempt_at`,
    `last_attempt_at` + índice parcial da fila elegível.
  - Enum `messages.template` e `message_templates` estendidos com **`reagendar_retorno`**
    (novo template de baseline/seed, texto pt-BR sem PII).
  - Setup de **pg_cron** (+ mecanismo de invocação) **versionado em migration**, condicional
    para não quebrar `db reset` quando a extensão não existir no ambiente local.
- **Edge Function de webhook de ENTRADA** (nova; recomendação de design: função separada,
  ex. `whatsapp-inbound`, por ser superfície pública sem JWT). Valida autenticidade + zod +
  idempotência; resolve tenant pela instância; casa resposta→agendamento; aplica efeito.
- **Job de lembrete D-1** (cron) que varre agendamentos elegíveis e enfileira `lembrete_d1`.
- **Worker de retentativa** (cron) que reenvia `messages.status='fila'` com backoff/limite.

**Reuso obrigatório (não recriar):** `appointments` + máquina de estados/trigger
(`confirmed_at`), `messages` (status/`dedupe_key`/`provider_message_id`), `whatsapp_instances`,
`message_templates` + render server-side, opt-in, normalização E.164, adapter Evolution
(mock/real por `EVOLUTION_MODE`).

### 2.2 Frontend (superfície pequena, mas real)

**Entra — ajustes cirúrgicos, zero rota nova, zero módulo novo:**

- **Agenda** (`/app/agenda`): micro-selo "confirmado pelo cliente" ao lado do badge
  `Confirmado`, quando a confirmação veio do cliente via WhatsApp (depende da coluna
  `appointments.confirmed_via` — ver §2.4 e §7).
- **Histórico de mensagens** (`/app/config/whatsapp`): rotular lembrete automático (cron),
  resposta recebida (sem PII — rótulo derivado, nunca o texto digitado), retorno de
  reagendamento, e o estado `fila` sob retentativa.
- Vocabulário pt-BR novo em `src/lib/whatsapp.ts`; extensão dos schemas zod de
  `useAppointments` e `useRecentMessages` para validar campos novos como dado não confiável
  (enums fechados).

### 2.3 Fora de escopo

- Botões/listas interativas da Evolution (a resposta é **numérica**, texto livre).
- Reagendamento automático / mudança de horário por resposta `2` (decisão "c": só mensagem
  de retorno + tratamento manual).
- Autoagendamento público, taxa de reserva antecipada, métricas consolidadas → **Fase 3**.
- Módulo Asaas/PIX (`cobranca`/`comprovante` seguem só sob demanda).
- Múltiplas instâncias de WhatsApp por tenant; recorte de leitura por profissional em
  `messages`/`webhook_events` (fase futura).
- Polling da agenda para a confirmação "aparecer sozinha" (otimização futura; refetch
  on-focus do TanStack Query cobre o fluxo real).

### 2.4 Dependência de contrato entre backend e frontend

O selo "confirmado pelo cliente" exige um dado que hoje **não existe**: `confirmed_at` é só
um timestamp e não diz **quem** confirmou. O frontend está **bloqueado** nisto:

- **Decisão (Opção A, preferida):** coluna nova `appointments.confirmed_via`
  (`cliente_whatsapp | manual`, nullable), gravada pelo webhook quando casa a resposta "1" e
  deixada `manual` na confirmação pela UI. Determinística, versionada, sob o RLS existente.
- **Se o planejamento decidir não criar a coluna nesta fatia:** o selo de origem **sai de
  escopo do frontend** e fica só o badge `Confirmado`. Registrar como corte explícito.
  (A Opção B — derivar a origem por join com `messages` — foi **rejeitada**: frágil, não
  determinística e expõe mais de `messages` à leitura da agenda, com risco de PII.)
- Para o histórico: `messages` precisa de forma de distinguir **direção** (recebida/enviada)
  e **origem** (cron/sob-demanda/resposta). Sem isso, o histórico fica só com o rótulo de
  template atual.

---

## 3. Requisitos e critérios de aceite testáveis

Cada requisito com entrada → saída observável. Testar o webhook com payload simulado (sem
WhatsApp real); testar cron/retentativa pela lógica (função/SQL de elegibilidade) quando o
scheduler real não estiver disponível, documentando o que ficou só verificado estaticamente.

### Lembrete D-1 automático (cron)

- **R1 — dispara D-1.** Entrada: agendamento `pendente`/`confirmado`, cliente
  `whatsapp_opt_in=true`, instância do tenant `conectado`, `starts_at` ~24h à frente
  (faixa configurável, p.ex. 23h–25h), sem `lembrete_d1` prévio. Saída: exatamente **uma**
  `messages` `template='lembrete_d1'` enfileirada.
- **R2 — idempotente.** Entrada: rodar o job duas vezes seguidas. Saída: **não** cria um
  segundo `lembrete_d1` para o mesmo agendamento (dedupe por `lembrete_d1:a:<appointmentId>`).
- **R3 — sem opt-in não dispara.** Entrada: cliente `whatsapp_opt_in=false`. Saída: **nenhum**
  `lembrete_d1`.
- **R4 — janela vencida.** Entrada: `starts_at` no passado. Saída: **não** recebe D-1 (nem
  novo, nem retentativa).

### Webhook de entrada (autenticidade, schema, idempotência)

- **R5 — autenticidade.** Entrada: POST sem o segredo correto. Saída: `401`,
  `webhook_events.status='rejeitado'`, **nenhum** agendamento muda.
- **R6 — schema inválido.** Entrada: payload que falha o zod. Saída: `400`/registro
  `rejeitado`, sem efeito.
- **R7 — idempotência de entrada.** Entrada: reenviar o **mesmo** evento (mesmo
  `external_event_id`). Saída: **não** gera segunda confirmação nem efeito repetido; a 2ª
  gravação em `webhook_events` é barrada pelo índice único e o processamento para antes do
  efeito.

### Casamento resposta → agendamento + transição de estado

- **R8 — casamento determinístico.** Entrada: telefone E.164 do remetente + tenant resolvido
  **pela instância**. Saída: encontra o agendamento do cliente no tenant com status
  `pendente`/`confirmado`, que teve `lembrete_d1` enviado, `starts_at` no futuro, escolhendo o
  de `starts_at` **mais próximo**. Se nenhum casar: `webhook_events.status='ignorado'`, sem
  efeito, sem erro ao provedor.
- **R9 — resposta "1" confirma.** Entrada: evento válido, texto `1`, casado a agendamento
  `pendente`/`confirmado`. Saída: `appointments.status='confirmado'` + `confirmed_at`
  carimbado (via trigger existente) + `confirmed_via='cliente_whatsapp'` (se Opção A);
  `webhook_events.status='processado'`, `parsed_intent='confirmar'`.
- **R10 — resposta "2" retorna, não altera.** Entrada: evento válido, texto `2`, casado.
  Saída: `appointments.status` **inalterado**; enfileira `messages`
  `template='reagendar_retorno'`; `webhook_events.parsed_intent='reagendar'`.
- **R11 — resposta não reconhecida.** Entrada: texto que não casa `1`/`2` (após normalização:
  trim, primeiro token, tolerância a "1 confirmar"). Saída: logado/`ignorado`, sem efeito
  (resposta "não entendi" é decisão do design; mínimo é ignorar).
- **R12 — isolamento no casamento.** Entrada: telefone que existe em **dois** tenants. Saída:
  casa **só** com o agendamento do tenant da instância que recebeu; nunca confirma de outro
  tenant.
- **R13 — transição inválida é segura.** Entrada: resposta `1` para agendamento já
  `cancelado`/`concluido`. Saída: a função **não** quebra (erro do trigger tratado), registra
  o resultado e segue.
- **R14 — resposta automática registrada.** A mensagem de retorno (R10) é registrada em
  `messages` com opt-in, idempotência e PII mínima, como o fluxo `send` da Fatia 1.

### Fila de retentativa

- **R15 — retentativa com backoff.** Entrada: `messages` em `fila` cujo envio falhou. Saída:
  reenviada pelo worker respeitando `next_attempt_at`; `attempts` incrementa a cada tentativa.
- **R16 — limite N.** Entrada: `attempts >= max_attempts`. Saída: `status='falha'` com
  `failure_reason`; não é mais reenviada.
- **R17 — retentativa respeita janela útil.** Entrada: `lembrete_d1` em `fila` cujo
  agendamento já passou de `starts_at`. Saída: `status='falha'` (`janela_vencida`), não
  reenviado.

### Segurança / dados / verificação

- **R18 — RLS `webhook_events`.** Usuário autenticado do tenant A **não** lê `webhook_events`
  do tenant B; o cliente **não** consegue INSERT/UPDATE/DELETE em `webhook_events`.
- **R19 — PII mínima.** `webhook_events.payload`, `messages.payload` e os logs **não** contêm
  telefone, documento nem o texto cru da mensagem em claro.
- **R20 — segredos fora do cliente.** Nenhum segredo (webhook/Evolution/service role) aparece
  no bundle do frontend nem em arquivo versionado; só `.env.example` com chaves vazias.
- **R21 — migrations versionadas.** Todo schema/cron está em migration nova; `db reset` roda
  limpo (ou, sem pg_cron local, não quebra e documenta a limitação).
- **R22 — build/typecheck.** `deno check` da(s) Edge Function(s) e o typecheck/build do
  projeto passam limpos; QA ao vivo do webhook com payload simulado cobre `1`, `2`, duplicado
  e inválido/não-autêntico.

---

## 4. Regras de fronteira que a demanda arrisca

Defeitos que esta fatia pode introduzir (do papel) e a invariante correspondente:

- **Isolamento multi-tenant (RLS).** Webhook e cron **nunca** cruzam tenants. No webhook não
  há JWT de usuário: o `tenant_id` é resolvido **pela instância**
  (`whatsapp_instances.evolution_instance_name → tenant_id`), no servidor, com service role —
  **nunca** do payload. No cron, cada linha candidata carrega seu `tenant_id`. RLS habilitado
  em `webhook_events` e em toda tabela de domínio nova. Risco: casar resposta ao agendamento
  de outro tenant → **proibido** (R12, R18).
- **Idempotência de webhook.** Processar o mesmo evento duas vezes **não** confirma em
  duplicidade (dedupe por `external_event_id`, índice único; o processamento para na 2ª
  gravação antes de qualquer efeito) — R7.
- **Autenticidade de webhook.** Verificada **antes** de qualquer efeito (segredo compartilhado
  `WHATSAPP_WEBHOOK_SECRET`, comparação em tempo constante; a Evolution v2.3.7 não assina HMAC
  por padrão). Sem match → `401` → `rejeitado` — R5. O design confirma o formato exato do
  payload de entrada na doc da Evolution v2.3.7 e valida tudo com zod.
- **Segredos fora do cliente.** Token Evolution, service role e segredo do webhook **só** no
  servidor/env; nunca `VITE_*`, nunca no bundle — R20.
- **LGPD.** Disparo só com `whatsapp_opt_in=true` — R3. PII mínima: sem telefone/documento/
  texto cru em claro em `payload` ou logs (telefone para dedupe/diagnóstico hasheado ou
  omitido) — R19. O histórico mostra rótulo derivado do efeito, nunca o texto digitado.
- **Status de assinatura.** O cron respeita o status do tenant no servidor
  (`bloqueado`/`cancelado` suspendem disparos, `seguranca-multitenant.md`).
- **Nunca confirmar sem resposta válida casada** — R8/R9/R11.

---

## 5. Perfis de acesso (quem executa cada ação)

- **Sistema / service role (servidor):** executa o cron (lembrete D-1 e worker de
  retentativa), processa o webhook de entrada, aplica a transição de status e escreve em
  `messages`/`webhook_events`. Nenhum cliente comum executa estas operações.
- **super_admin:** sem caminho pelo cliente para `webhook_events`/operações privilegiadas
  (cross-tenant só por Edge Function auditada, fora desta fatia).
- **admin / receptionist / professional (tenant):** **leem** o efeito já persistido —
  o selo de confirmação na agenda (informação operacional, não financeira) e o histórico de
  mensagens (projeção **sem PII**). `professional` vê o selo só nos próprios agendamentos
  (herda o recorte de linhas da agenda). `receptionist` continua **sem** telas/dados
  financeiros (esta fatia não toca financeiro). Nenhum papel do cliente escreve em
  `webhook_events` (R18).

---

## 6. Enquadramento no roadmap e dependências

- **Roadmap (`produto.md`):** confirmação interativa D-1 é objetivo central (reduzir no-show).
  Esta é a **Fatia 2 da Fase 2 do WhatsApp**, logo após a Fatia 1 (templates + render
  server-side, já em master). Cobre RF10/RF11 + RNF04 (fila de retentativa) da skill
  whatsapp-evolution.
- **Dependências anteriores (consome, não recria):** máquina de estados de `appointments`
  (`confirmado` + `confirmed_at` via trigger), `messages` com idempotência de envio
  (`dedupe_key`), `whatsapp_instances`, `message_templates` + render server-side, opt-in,
  normalização E.164 e adapter Evolution (mock/real).
- **Respeita o fora-de-escopo do MVP:** autoagendamento público, taxa de reserva antecipada e
  métricas consolidadas permanecem **Fase 3** — não implementar aqui.

---

## 7. Pontos levantados pelo usuário (nenhum descartado)

| # | Ponto do usuário | Tratamento |
|---|---|---|
| 1 | "Primeiro os templates e depois a interação" | **Decisão tomada.** Templates = Fatia 1 (entregue em master). Esta fatia é a interação. Ordem respeitada. |
| 2 | "Resposta pode ser numérica" | **Decisão tomada.** Resposta **numérica** (`1` confirmar / `2` reagendar). Botões interativos ficam fora de escopo. |
| 3 | "Se responder sim, marca a agenda como confirmado" (e "é possível com a Evolution API?") | **Decisão tomada.** Resposta `1` → `appointments.status='confirmado'` + `confirmed_at` (R9). Viável com Evolution via webhook de entrada (confirmar payload na doc v2.3.7 no design). |
| 4 | "Analise se tem mais melhorias possíveis" | **Decisões tomadas.** Incorporadas: fila de retentativa (RNF04), auditoria/idempotência via `webhook_events`, selo de origem da confirmação na agenda, rotulagem do histórico. |
| 5 | Resposta `2` (reagendar) = **opção c** | **Decisão tomada.** Mensagem automática de retorno (`reagendar_retorno`) + tratamento manual; **sem** reagendamento automático, **sem** mudar horário (R10). |
| 6 | Lembrete D-1 via **pg_cron** | **Decisão tomada.** Job agendado via pg_cron, versionado em migration, condicional ao ambiente (R1–R4, R21). |

**Perguntas em aberto deixadas para o design (não bloqueiam o PRD):** faixa exata da janela
D-1 (ex. 23h–25h) e granularidade do cron; mecanismo de invocação do cron (pg_net POST vs.
função SQL `security definer`); parâmetros de backoff (base, fator, N); webhook como função
separada (recomendado) vs. nova rota; formato exato do payload de entrada da Evolution v2.3.7
(a confirmar na doc); se há resposta automática "não entendi" para R11. A decisão de criar
`appointments.confirmed_via` (§2.4) — adotar Opção A é a recomendação; se recusada, o selo de
origem sai de escopo do frontend.

---

## 8. Critério de aceite visual (frontend, verificável via Chrome DevTools)

1. **Selo — confirmado pelo cliente.** Agendamento `status=confirmado` +
   `confirmed_via=cliente_whatsapp` mostra o badge `Confirmado` **mais** o micro-selo (ícone
   WhatsApp + `aria-label` "Confirmado pelo cliente no WhatsApp"), na lista e no bloco de
   calendário (modo não-compacto). Verificável pela presença do `aria-label` no DOM e visual.
2. **Selo — confirmado manualmente.** Agendamento `confirmado` + `confirmed_via=manual` mostra
   **só** o badge `Confirmado`, sem micro-selo; `title` do badge: "Confirmado pela recepção".
3. **Histórico — lembrete automático.** Após o cron, a linha `lembrete_d1` aparece com rótulo
   "Lembrete (24h antes)" e indicador "Enviada", **sem PII**.
4. **Histórico — resposta recebida.** A resposta aparece como "Recebida" com rótulo derivado
   ("Confirmação do cliente" / "Pedido de reagendamento"), **nunca** o texto digitado; direção
   por **ícone + texto**, não cor.
5. **Histórico — fila/retentativa.** Mensagem em retentativa: badge `Na fila` + `title`
   "Aguardando reenvio automático"; após o limite, badge `Falha` + `title` "Falhou após
   várias tentativas".
6. **Contraste (claro e escuro).** Medir no DevTools o contraste do texto do badge
   `Confirmado` (mirar ≥ 4,5:1) e do ícone do micro-selo contra `bg-card` (mirar ≥ 3:1, WCAG
   1.4.11), nos dois temas; registrar os números medidos e ajustar token/opacidade se abaixo.
7. **Teclado/foco.** Tab chega ao bloco do agendamento com anel de foco visível; o selo não
   cria alvo de foco extra nem quebra a ordem de tab; `aria-label` lido junto do bloco.
8. **Mobile (~375px).** Lista e blocos não estouram com selo + badge; no bloco compacto o selo
   cai no `title`; histórico em cards no mobile preservado.
9. **PII na UI.** Em nenhuma superfície (agenda, histórico, tooltip, DOM) aparece telefone do
   cliente ou texto literal recebido.

> Nota: validação completa de WCAG exige teste manual com tecnologia assistiva e revisão
> especializada; os itens acima são o que se verifica via DevTools nesta fatia.
