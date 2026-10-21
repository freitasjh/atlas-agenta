# Parecer do Revisor B — ADR-06 (Frontend: selo "confirmado pelo cliente" + rotulagem do histórico)

Commit revisado: `56e21e4` (`feat: selo 'confirmado pelo cliente' na agenda e rotulagem do historico (ADR-06)`), diff sobre o pai `0431f40` (topo da pilha da Fatia 2). Base lógica da fatia: `origin/master`.

Frontend cirúrgico, exatamente na fronteira que a ADR desenhou: `confirmed_via` entra em tipo + zod row-schema + `APPOINTMENT_SELECT` na mesma mudança (a regra do brain `estender-interface-de-linha-exige-atualizar-select-e-zod`), nasce um micro-selo determinístico pela coluna, e o histórico ganha o label `reagendar_retorno` e notas de estado de retentativa no `title`. Zero rota nova, zero módulo novo, projeção do histórico continua sem PII. Confirmei as duas dependências na própria árvore: a migration `20250223091000` cria `appointments.confirmed_via check in ('cliente_whatsapp','manual')` e o webhook `whatsapp-inbound` grava `confirmed_via='cliente_whatsapp'` na confirmação — então o selo tem de onde sair.

Watch for: a ADR (ponto 5) prometia rotulagem de histórico mais rica — `getInboundIntentLabel`, distinção "recebida vs enviada" — que **não** foi implementada; verifiquei que isso é correto e não um corte indevido, porque o webhook (ADR-03) não persiste linha de `messages` para a resposta do cliente (só `webhook_events`, PII-mínima) — não existe linha de entrada a rotular (confirmado). A gravação de `confirmed_via='manual'` pela UI é um acréscimo de comportamento face à Fatia 1 que merece registro, mas é seguro sob RBAC/RLS (confirmed).

**Verdict**: APPROVED

## High-level view

A extensão de contrato de linha está completa e consistente: `confirmed_via` aparece em `Appointment` (via const `APPOINTMENT_CONFIRMED_VIA` + tipo derivado), no `appointmentRowSchema` como `z.enum(...).nullable()`, e na string `APPOINTMENT_SELECT` do PostgREST — os três na mesma mudança, que é o que impede o `tsc -b` de quebrar com `Property 'confirmed_via' is missing`. `reagendar_retorno` entra em `MESSAGE_TEMPLATES`, e como o `messageRowSchema` deriva o enum de `MESSAGE_TEMPLATES`, a paridade do histórico fecha sem edição extra em `useMessages`.

O selo é determinístico e não-redundante: `ClientConfirmedBadge` só renderiza com `status==='confirmado' && confirmed_via==='cliente_whatsapp'`; `manual`/`null` caem no `StatusBadge` "Confirmado" sozinho, exatamente a semântica da Opção A que o humano aprovou no PRD §2.4. A distinção nunca é por cor: há ícone `Check` + `aria-label`, o selo é `role="img"` decorativo (não entra na ordem de tab), e no bloco compacto do calendário ele some e a informação vai pro `title` — fiel ao ponto 4 da ADR.

A rotulagem de retentativa no histórico é um `title` pt-BR derivado só de `status` (`fila`→"Aguardando reenvio automático", `falha`→"Falhou após várias tentativas"), sem PII nem texto cru. A superfície de histórico rica que a ADR esboçou no ponto 5 foi reduzida ao que o modelo de dados realmente produz — decisão correta, detalhada abaixo.

O acréscimo de `confirmed_via='manual'` no `useChangeAppointmentStatus` ao confirmar pela UI não existia na Fatia 1 e não está listado como obrigatório nos critérios de aceite, mas é o que torna o selo determinístico (distingue manual de cliente); é escrita numa coluna que recepção/admin já podem atualizar via `status`, sem tocar dado financeiro, então não abre brecha de RBAC/RLS.

Contraprova verde: `npm run typecheck`, `npm run build` e `npm run test` (32 testes) passam.

<details>
<summary>Issues (2)</summary>

1. **Rotulagem de histórico do ponto 5 não implementada (por design)** — a ADR prometia `getInboundIntentLabel` e distinção recebida/enviada; o webhook não grava linha de `messages` para a resposta do cliente, então não há o que rotular. Nenhuma ação de código; recomenda-se só anotar no veredito/ADR-07 que esse item foi resolvido por ausência de dado, para o QA não procurar um label de entrada que não existe. (confirmado)
2. **`confirmed_via='manual'` gravado pela UI é comportamento novo** — correto e seguro, mas não consta dos critérios de aceite da ADR como obrigatório. Garantir que o QA (ADR-07) cubra o caminho: confirmar pela recepção deve resultar em `confirmed_via='manual'` e, portanto, **sem** micro-selo (só o badge). (confirmado)

</details>

<details>
<summary>Details</summary>

### Extensão de contrato de linha: tipo + zod + select juntos

O risco clássico aqui é estender só o tipo e esquecer o `select` ou o zod, o que o projeto já codificou como regra. O diff acerta os três pontos de uma vez:

- `src/types/domain.ts`: `APPOINTMENT_CONFIRMED_VIA = ['cliente_whatsapp','manual'] as const`, tipo `AppointmentConfirmedVia` derivado, e `confirmed_via: AppointmentConfirmedVia | null` em `Appointment` (herdado por `AppointmentWithRelations`). O comentário documenta a semântica de `null` (não confirmado OU linha legada da Fatia 1) — alinhado ao `check` da migration, que permite só os dois valores não-nulos.
- `useAppointments.ts`: `confirmed_via: z.enum(APPOINTMENT_CONFIRMED_VIA).nullable()` no `appointmentRowSchema` **e** `confirmed_via` acrescentado à string `APPOINTMENT_SELECT`. Com o `select` trazendo a coluna e o zod validando, o parse não quebra em runtime nem em tipo.

`reagendar_retorno` entra em `MESSAGE_TEMPLATES`. Como `messageRowSchema.template` em `useMessages.ts` é `z.enum(MESSAGE_TEMPLATES)` e `TEMPLATE_LABELS` é `Record<MessageTemplate, string>`, a adição do membro força o label em `whatsapp.ts` (que está lá: "Retorno de reagendamento") — a exaustividade do `Record` é o que garante que nenhum template fique sem rótulo pt-BR.

### Selo determinístico e a decisão de contrato (Opção A)

`ClientConfirmedBadge` recebe `Pick<Appointment, "status" | "confirmed_via">` e aplica a guarda `status==='confirmado' && confirmed_via==='cliente_whatsapp'`. Isso materializa a Opção A aprovada pelo humano (PRD §2.4): a origem vem da coluna, não de um join com `messages`. `manual` e `null` não ganham selo — exatamente a semântica pedida (tratar `null` como manual/origem desconhecida das linhas legadas).

A11y conforme PRD §8: `role="img"` + `aria-label="Confirmado pelo cliente no WhatsApp"`, ícone `Check aria-hidden`, sinal nunca só por cor. O selo não cria alvo de foco extra. No bloco compacto (`AppointmentBlock`, `compact===true`), o selo é suprimido e a frase vai concatenada no `title` do `<button>` — preserva espaço e mantém a informação acessível por hover/AT. Na lista (`AgendaItem`) o selo fica ao lado do `StatusBadge` num wrapper `flex gap-1.5`.

Reuso de token: o selo usa `bg-status-confirmado text-status-confirmado-foreground`. Confirmei no `tailwind.config` que `status-confirmado.foreground → hsl(var(--status-confirmado-fg))` e que `--status-confirmado`/`-fg` existem nos dois temas em `index.css` — ou seja, nenhum token novo, o contraste herda o do `StatusBadge` já calibrado. A medição AA fica para o QA (ADR-07), como a ADR previu.

### Rotulagem do histórico: escopo reduzido ao que o dado produz

A ADR, no ponto 5, descreveu uma rotulagem mais ambiciosa: um `getInboundIntentLabel('confirmar'|'reagendar')`, distinção "recebida vs enviada", indicador "Enviada". O diff entrega menos: só o label `reagendar_retorno` e os `title` de `fila`/`falha` via `getMessageStatusHint`. Investiguei se isso é um corte indevido e concluí que **não é**:

- O webhook `whatsapp-inbound` nunca insere em `messages` uma linha representando a resposta crua do cliente. Os únicos inserts em `messages` são o **outbound** `reagendar_retorno` (template conhecido, `payload` só com metadados `template/appointment_id/origin`, sem texto). A resposta "1"/"2" do cliente só é registrada em `webhook_events` com payload PII-mínima.
- Logo, em `RecentMessagesList` toda linha é um disparo de saída com `template` conhecido. Não há direção "recebida" a distinguir nem texto cru a vazar — a premissa do `getInboundIntentLabel` simplesmente não se concretiza no modelo de dados da ADR-03.

Então o helper hipotético teria ficado morto. A redução é coerente. **Recomendo registrar isso explicitamente** (veredito/ADR-07) para o QA não cobrar um label de entrada inexistente — é a única pendência de "aderência à ADR" e ela se resolve por ausência de dado, não por falta de código.

Projeção sem PII mantida: `RecentMessagesList` (não tocado neste diff) renderiza só nome do cliente (de `useCustomers`, sob RLS), label do template, badge de status e data. `payload` é selecionado pelo `MESSAGE_SELECT` mas não é renderizado, e por contrato (ADR-03) carrega só metadados. Sem telefone, sem corpo. R19/§8.9 preservados.

### `confirmed_via='manual'` na confirmação pela UI — comportamento novo, seguro

`useChangeAppointmentStatus` passa a montar `patch = to==='confirmado' ? { status, confirmed_via:'manual' } : { status }`. Esse carimbo não existia na Fatia 1 e não está entre os critérios de aceite obrigatórios da ADR, mas é o que dá determinismo ao selo (sem ele, uma confirmação manual ficaria `null` e seria indistinguível de legado — o que ainda cairia no "sem selo", então o selo em si não quebra; o ganho é a coerência da coluna daqui pra frente).

Segurança: `confirmed_via` é coluna de `appointments`, que recepção e admin já atualizam ao mudar `status` — não é dado financeiro (`charges`), então não cruza a restrição de RBAC da recepção. A migration só valida o valor por `check`; o trigger `appointments_transition_guard` valida apenas `status`, então o update conjunto não conflita (o próprio webhook faz o mesmo update combinado). Sem brecha de isolamento: nenhum `tenant_id` vindo do cliente, o update é por `.eq("id", id)` sob RLS do usuário. Ação recomendada: QA (ADR-07) deve exercitar "confirmar pela recepção → `confirmed_via='manual'` → só badge, sem micro-selo", que hoje não tem teste automatizado.

### Retentativa no badge

`getMessageStatusHint` retorna `undefined` para estados que não precisam de nota e os dois textos pt-BR para `fila`/`falha`. `WhatsAppStatusBadge` só aplica `title` no ramo de mensagem (conexão fica `undefined`). O `title` é derivado puramente do enum de status — nada de PII.

### Contraprova

- `npm run typecheck` (`tsc -b`): limpo.
- `npm run build` (`tsc -b && vite build`): sucesso (aviso pré-existente de chunk > 500 kB, não introduzido por esta ADR).
- `npm run test` (`vitest run`): 32/32 (`message-templates`, `scheduling-slots`). Nenhum teste existente toca os módulos alterados; nenhum teste novo exigido pela convenção do projeto (testes só sob pedido).

Não subi dev server — verificação visual/contraste/mobile ~375px e os cenários de selo são do QA (ADR-07), conforme instrução.

</details>

<details>
<summary>Mapa de arquivos</summary>

- `src/types/domain.ts` — `APPOINTMENT_CONFIRMED_VIA` + tipo; `confirmed_via` em `Appointment`; `reagendar_retorno` em `MESSAGE_TEMPLATES`.
- `src/hooks/useAppointments.ts` — zod row-schema + `APPOINTMENT_SELECT` ganham `confirmed_via`; `confirmed_via='manual'` no update de confirmação pela UI.
- `src/components/ClientConfirmedBadge.tsx` (novo) — micro-selo determinístico, a11y, reuso de token.
- `src/app/agenda/AppointmentBlock.tsx` — selo no bloco não-compacto; frase no `title` no compacto.
- `src/app/agenda/AgendaPage.tsx` — selo ao lado do `StatusBadge` na lista.
- `src/lib/whatsapp.ts` — label `reagendar_retorno`; `MESSAGE_STATUS_HINTS` + `getMessageStatusHint`.
- `src/components/WhatsAppStatusBadge.tsx` — `title` de estado (fila/falha) via hint.

Diff completo: `git show 56e21e4 -- src/`.

</details>
