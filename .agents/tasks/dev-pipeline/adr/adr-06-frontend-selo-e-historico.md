# ADR-06 — Frontend: `confirmed_via` nos tipos/select/zod, selo "confirmado pelo cliente" na agenda e rotulagem do histórico

**Status:** proposto
**Escopo:** frontend (React + Vite + TS + Tailwind + shadcn/ui)
**Depende de:** adr-01 (coluna `appointments.confirmed_via`, template `reagendar_retorno`,
estados de retentativa em `messages`), adr-03 (o webhook é quem grava `confirmed_via=cliente_whatsapp`)

## Contexto

Superfície de frontend pequena e cirúrgica: **zero rota nova, zero módulo novo**. Dois ajustes
visíveis (PRD §2.2 e §8): (1) micro-selo "confirmado pelo cliente" na agenda; (2) rotulagem do
histórico de mensagens para o lembrete automático, o retorno de reagendamento e o estado de
retentativa. Mais a extensão do vocabulário pt-BR e dos schemas zod para validar os campos novos
como dado não confiável.

Fatos consumidos (código atual, mesma árvore de origin/master):
- `src/types/domain.ts`: `Appointment`/`AppointmentWithRelations` (sem `confirmed_via`);
  `MESSAGE_TEMPLATES` (4 chaves); `MESSAGE_STATUSES` (`fila|enviado|entregue|falha`).
- `src/hooks/useAppointments.ts`: `appointmentRowSchema` (zod) + `APPOINTMENT_SELECT` (string do
  PostgREST). **Regra do projeto** (brain `estender-interface-de-linha-exige-atualizar-select-e-zod`):
  ao adicionar campo ao tipo de linha, atualizar NA MESMA mudança o zod row-schema E toda string
  `.select(...)` que parseia para o tipo — senão o `tsc -b` quebra.
- `src/lib/whatsapp.ts`: `TEMPLATE_LABELS` (fonte única de rótulos pt-BR), `getMessageTemplateLabel`,
  `getMessageStatusLabel`.
- `src/app/agenda/AppointmentBlock.tsx` e a lista em `AgendaPage`: desenham `StatusBadge`.
- `src/app/config/whatsapp/RecentMessagesList.tsx`: tabela desktop + cards mobile; usa
  `getMessageTemplateLabel(message.template)` e `WhatsAppStatusBadge`.
- `src/hooks/useMessages.ts`: `messageRowSchema` (zod) + `MESSAGE_SELECT` (sem PII) + enums.

### Decisão de contrato (PRD §2.4)

A **Opção A foi mantida pelo humano**: existe `appointments.confirmed_via` (`cliente_whatsapp|manual|
null`). O selo de origem é determinístico a partir dessa coluna. (A Opção B — derivar por join com
`messages` — foi rejeitada.) Semântica da UI: `confirmed_via='cliente_whatsapp'` → micro-selo;
`'manual'` **ou** `null` (com status `confirmado`) → só o badge `Confirmado` (tratar `null` como
"manual/origem desconhecida", pois a confirmação manual da Fatia 1 não gravava origem).

## Decisão

1. **Tipos (`src/types/domain.ts`):**
   - Acrescentar `confirmed_via: 'cliente_whatsapp' | 'manual' | null` a `Appointment` (e portanto a
     `AppointmentWithRelations`). Exportar um `APPOINTMENT_CONFIRMED_VIA` const se útil para o zod.
   - Acrescentar `'reagendar_retorno'` a `MESSAGE_TEMPLATES`.

2. **Hook de agenda (`src/hooks/useAppointments.ts`):** adicionar `confirmed_via` ao
   `appointmentRowSchema` (`z.enum([...]).nullable()`) **e** à string `APPOINTMENT_SELECT`. Não é
   necessário enviar a coluna em inserts/updates (o banco/trigger/webhook a controlam). (A confirmação
   **manual** pela UI, via `useChangeAppointmentStatus`, pode opcionalmente passar a gravar
   `confirmed_via='manual'` ao mudar para `confirmado` — decisão: **sim**, gravar `manual`
   explicitamente nesse update, para o selo distinguir determinísticamente; isso mantém a coluna
   coerente. O trigger não conflita, pois só valida `status`.)

3. **Vocabulário pt-BR (`src/lib/whatsapp.ts`):**
   - `TEMPLATE_LABELS.reagendar_retorno = "Retorno de reagendamento"`.
   - Rótulos derivados para o histórico de ENTRADA/estado, sem PII: um helper
     `getInboundIntentLabel('confirmar'|'reagendar'|...)` → "Confirmação do cliente" / "Pedido de
     reagendamento"; e rótulos de retentativa/falha ("Aguardando reenvio automático", "Falhou após
     várias tentativas") — reusados pelos `title` dos badges. Tudo pt-BR, fonte única aqui.

4. **Selo na agenda (`AppointmentBlock.tsx` + a lista em `AgendaPage`/`AgendaItem`):**
   - Quando `status === 'confirmado' && confirmed_via === 'cliente_whatsapp'`, renderizar, ao lado
     do `StatusBadge`, um micro-selo: ícone WhatsApp (lucide-react, ex. `MessageCircle`/`Check`) com
     `aria-label="Confirmado pelo cliente no WhatsApp"`. No bloco **compacto** do calendário, o selo
     cai no `title` (não ocupa espaço). Reforço nunca por cor sozinha (ícone + aria-label/texto).
   - `confirmed_via='manual'`/`null`: só o badge `Confirmado`; `title` "Confirmado pela recepção".
   - Não criar alvo de foco extra (o selo é decorativo + aria-label; o `<button>` do bloco continua
     sendo o único foco).

5. **Histórico (`RecentMessagesList.tsx` + `useMessages.ts`):**
   - `useMessages.ts`: estender `messageRowSchema` para o enum de template incluir `reagendar_retorno`
     (vem de `MESSAGE_TEMPLATES`, então basta a extensão do enum no domínio). Manter a projeção
     **sem PII** — não adicionar telefone/texto. Se a UI precisar distinguir "recebida vs enviada"
     ou a origem (cron/sob-demanda), derivar de dados já disponíveis sem PII (template +
     failure_reason + status); **não** expor o texto cru nem o conteúdo da resposta.
   - Rotular: `lembrete_d1` → "Lembrete (24h antes)" (já existe) com indicador "Enviada";
     `reagendar_retorno` → "Retorno de reagendamento"; estado `fila` sob retentativa → badge
     `Na fila` + `title` "Aguardando reenvio automático"; `falha` após limite → badge `Falha` +
     `title` "Falhou após várias tentativas". Direção por **ícone + texto**, nunca só cor.
   - O histórico **nunca** mostra o texto digitado pelo cliente (R19/§8.9): se houver linha
     representando a resposta recebida, exibir só o rótulo derivado da intenção.

6. **Acessibilidade e responsividade (PRD §8):** foco visível mantido; selo não quebra a ordem de
   tab; contraste do badge `Confirmado` (mirar ≥ 4,5:1) e do ícone do selo contra `bg-card` (mirar ≥
   3:1) nos temas claro/escuro — medir no QA (ADR-07). Mobile ~375px: lista e blocos não estouram
   com selo+badge; histórico em cards no mobile preservado.

## Consequências

- O selo distingue, de forma determinística e barata (uma coluna), confirmação do cliente vs manual
  — o valor de negócio visível da fatia.
- Paridade do novo template `reagendar_retorno` fechada no frontend (enum + label).
- Projeção do histórico continua sem PII; a origem/intenção vira rótulo derivado.
- TypeScript estrito mantido; a regra "tipo de linha + zod + select juntos" evita quebrar o build.

## Arquivos afetados

- `src/types/domain.ts` (confirmed_via em Appointment; reagendar_retorno em MESSAGE_TEMPLATES)
- `src/hooks/useAppointments.ts` (zod + SELECT; gravar confirmed_via='manual' na confirmação pela UI)
- `src/lib/whatsapp.ts` (label do novo template + helpers de rótulo derivado/retentativa)
- `src/app/agenda/AppointmentBlock.tsx` e a lista da agenda (`AgendaPage.tsx`/item) — micro-selo
- `src/app/config/whatsapp/RecentMessagesList.tsx` — rotulagem de template/estado
- `src/hooks/useMessages.ts` — enum de template estendido (via domain), projeção sem PII mantida
- Possível ajuste em `src/components/WhatsAppStatusBadge.tsx` para o `title` de fila/falha

## Critérios de aceite testáveis (desta ADR)

1. `npm run build` + `npm run typecheck` limpos após estender tipo/zod/select (sem erro de
   `Property 'confirmed_via' is missing`).
2. `npm run test -- --run` passa (se algum teste existente tocar esses módulos).
3. Visual (QA via Chrome DevTools, ADR-07): agendamento `confirmado`+`cliente_whatsapp` mostra badge
   `Confirmado` **mais** o micro-selo com `aria-label="Confirmado pelo cliente no WhatsApp"` no DOM;
   `confirmado`+`manual`/`null` mostra só o badge. Histórico mostra "Lembrete (24h antes)"/"Enviada",
   "Retorno de reagendamento", e estados `Na fila`/`Falha` com os `title` certos; em nenhum lugar
   aparece telefone nem texto cru (§8.9). Contraste medido nos dois temas; mobile ~375px sem overflow.

## Verificação

- `npm run build`, `npm run typecheck`, `npm run test -- --run` na raiz.
- QA visual consolidado na ADR-07 (dev server + chrome-devtools): popular um agendamento com
  `confirmed_via='cliente_whatsapp'` e outro `manual`/`null`, e `messages` nos estados relevantes.
