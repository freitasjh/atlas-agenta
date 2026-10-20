# Ação "Enviar mensagem" sob demanda em Agenda e Clientes (ADR-08) — Parecer Revisor B

Diálogo reusável `SendMessageDialog` disparado por botões gated em `AgendaPage` e `ClientesPage`, invocando a Edge Function `whatsapp` via `useSendMessage`. Reflete em pt-BR os outcomes `sent`/`duplicate`/`opt_out`/`not_connected`/`send_failed`, desabilita o envio na borda quando `whatsapp_opt_in=false` (defesa dupla), e não introduz nada financeiro. O join da agenda passou a trazer `customers.whatsapp_opt_in` para gatear a ação sem request extra.

Watch for: navegação de `not_connected` via `window.location.href` força reload de SPA, inconsistente com o `Link` do react-router usado na mesma tela (confirmed, menor). Botão "Enviar" `disabled` fica fora da ordem de tab, então o `title` não é alcançável por teclado — mitigado por `sr-only` adjacente, dentro do que o design doc §6 aceita (confirmed, menor). Acoplamento estrutural do botão de envio ao bloco `canManage` na Agenda (confirmed, informativo, sem impacto no RBAC atual).

**Verdict**: APPROVED

<details>
<summary>Issues (3)</summary>

1. **Reload de SPA no `not_connected`** — a ação do toast usa `window.location.href = "/app/config/whatsapp"`, causando full reload e perda de estado do app; trocar por navegação react-router (`useNavigate`/`Link`) como já é feito no aviso de opt-in do mesmo arquivo. Menor, não bloqueante.
2. **`title` em botão desabilitado** — o motivo do opt-in via `title` não é alcançável por teclado (botão `disabled` sai da ordem de tab); o `sr-only` adjacente cobre leitores lineares, mas o QA deve confirmar o anúncio. Dentro do previsto pelo design doc §6.
3. **Botão de envio acoplado a `canManage` na Agenda** — na `AgendaItem` o botão fica dentro do bloco `{canManage ?}`; como `canManageAppointments` e `canSendWhatsAppMessage` cobrem o mesmo conjunto de papéis hoje, não há regressão, mas a ação de envio não é independente da capacidade de gerenciar. Informativo.

</details>

<details>
<summary>Details</summary>

## Aderência à ADR e ao design doc

Todos os itens da Decisão da ADR-08 estão implementados e batem com o `analysis-frontend.md`:

- `SendMessageDialog.tsx` novo, reusado por Agenda e Clientes, com `react-hook-form` + `zodResolver(sendMessageSchema)`, `select` de template default `confirmacao`, confirmação via `useSendMessage`. Segue o esqueleto do `StatusChangeConfirm` (confirmação + `isPending` com `Loader2` + `toast`).
- Mapeamento de outcome correto e idêntico ao contrato: `sent` → `toast.success` + fecha; `duplicate` → `toast.info` (informativo, não-erro) + fecha; `not_connected` → `toast.error` com ação "Conectar"; `opt_out`/`send_failed` → `toast.error` sem fechar (deixa o motivo visível, retry seguro pela idempotência do servidor). O `outcome` lido é o campo real de `SendResponse` (`src/lib/whatsapp.ts`), sem divergência de contrato.
- Gatilhos pontuais nas telas existentes (não reescrita): botão em `AgendaItem` ao lado de Editar/Mudar status, gated por `canSendWhatsAppMessage`; ação por cliente em `ClientesPage` (desktop e mobile), gated igual.
- Opt-in na borda: botão `disabled` com motivo pt-BR em `title` + `sr-only`, e dentro do diálogo um `role="note"` visível com atalho `Link` para `/app/clientes`. `whatsapp_opt_in` vem do join da agenda / da linha de cliente, sem request extra.

## Fronteiras de segurança

**Multi-tenant / `tenant_id`:** nenhum `tenant_id` sai do cliente. O `useSendMessage` monta o body com apenas `action`/`template`/`customerId`/`appointmentId?`; o diálogo passa só `customerId`/`appointmentId`. Satisfaz A5/CA-F10/CA-21.

**RLS/RBAC:** a UI é defesa em profundidade coerente — `canSendWhatsAppMessage = admin || receptionist || professional` (`usePermissions`), alinhado ao design §2.2. O `professional` só vê a ação nos agendamentos que o RLS já filtra; na lista de clientes passa a ver a coluna Ações só com o botão de envio (a trava real de leitura/escrita continua no banco). A alteração do gate da coluna para `canManageCustomers || canSendWhatsAppMessage` é correta e não expõe Editar/Remover a quem não tem `canManageCustomers`.

**Idempotência:** a UI trata `duplicate` como no-op benigno (`toast.info`, sem 2ª linha), e o retry em `send_failed` é seguro porque a dedupe é autoritativa no servidor (ADR-03/ADR-04). Satisfaz A4/CA-F06/CA-19.

**Segredos / LGPD:** nenhum token Evolution, service role ou segredo tocado; o diálogo não renderiza telefone nem corpo com PII — identifica o destino pelo `customerName`. A resposta da função é tratada como dado não confiável e validada por zod no hook antes de chegar ao diálogo. O gancho "ao concluir → cobrança" em `StatusChangeConfirm` permanece **só comentário** (`// GANCHO (fase financeira)...`); nenhum `charges`/PIX/Asaas introduzido. Satisfaz A7/CA-18/CA-22.

## Observações de qualidade (não bloqueantes)

A navegação do outcome `not_connected` usa `window.location.href`, que recarrega a SPA e descarta cache do TanStack Query e estado de rota; o mesmo arquivo já importa `Link` do react-router para o aviso de opt-in, então a inconsistência é gratuita. O design §5.2 pede apenas "erro pt-BR com link para conectar", sem exigir reload — preferir `useNavigate`.

O botão desabilitado por opt-in expõe o motivo por `title` (não alcançável por teclado, pois `disabled` remove da ordem de foco) e por `sr-only` adjacente. O design §6 aceita explicitamente "texto adjacente, não só `disabled`", então está dentro do previsto; o QA deve confirmar no Chrome DevTools que o leitor de tela anuncia o motivo.

## Contraprova

- `npm run typecheck` (`tsc -b`): limpo, sem erros, sem `any` (TS estrito). Satisfaz A1/CA-F11.
- `npm run build` (`tsc -b && vite build`): sucesso, `✓ built in ~5s`. O aviso de chunk > 500 kB é **pré-existente** (bundle único do projeto, não introduzido por esta ADR).
- Não há script de lint/test no `package.json`; o gate de qualidade existente é typecheck + build, ambos verdes.
- Não subi dev server — a verificação visual (CA-F01..CA-F09, A2/A3/A6) é do QA no step seguinte via Chrome DevTools.

</details>

<details>
<summary>Arquivos no escopo da ADR (commit 3dc69b9)</summary>

- `src/app/whatsapp/SendMessageDialog.tsx` (novo) — diálogo de envio reusável.
- `src/app/agenda/AgendaPage.tsx` — botão "Enviar mensagem" em `AgendaItem` + montagem do diálogo.
- `src/app/clientes/ClientesPage.tsx` — ação por cliente (desktop + mobile) + montagem do diálogo.
- `src/hooks/useAppointments.ts` — join passa a trazer `customers.whatsapp_opt_in` (schema zod + `APPOINTMENT_SELECT`).
- `src/types/domain.ts` — `AppointmentWithRelations.customers` ganha `whatsapp_opt_in: boolean`.

Diff completo: `git show 3dc69b9`.

</details>
