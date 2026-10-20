# ADR-08 — Ação "Enviar mensagem" sob demanda (diálogo em Agenda e Clientes)

- **Status:** proposto
- **Escopo:** frontend
- **Depende de:** ADR-05 (lib, zod, mapa de erro, permissões), ADR-06 (`useSendMessage`) e ADR-07 (tela de conexão, para o link "conecte antes de enviar"). É a última ADR da fase — fecha a metade "enviar".

## Contexto

A segunda superfície de UI não é rota: é uma **ação** (botão → diálogo de confirmação) acoplada a (i) um agendamento na Agenda e (ii) um cliente na tela de Clientes. Dispara a Edge Function de envio e reflete em pt-BR sucesso, duplicado (idempotência), bloqueio por opt-in e instância desconectada. Sem régua automática — só disparo manual. O diálogo segue o esqueleto do `StatusChangeConfirm` (confirmação + `isPending` com `Loader2` + `toast` + mapa de erro).

## Decisão

1. **`src/app/whatsapp/SendMessageDialog.tsx`** (reusado por Agenda e Clientes): diálogo shadcn (`Dialog`/`DialogFooter`) com `react-hook-form` + resolver zod (`src/lib/validations/whatsapp.ts`); `select` de template (default `confirmacao`); confirma via `useSendMessage`. Resultado:
   - `sent` → toast "Mensagem enviada."; invalida o log.
   - `duplicate` → toast **informativo** (não-erro) "Esta mensagem já foi enviada para este agendamento." e nenhuma 2ª linha.
   - `opt_out` → bloqueio pt-BR (defesa dupla; ver item 3).
   - `not_connected` → "Conecte o WhatsApp antes de enviar mensagens." com link para `/app/config/whatsapp`.
   - Falha de transporte → toast genérico + retry seguro (idempotência no servidor).

2. **Gatilhos nas telas existentes** (alteração pontual, não reescrita):
   - `src/app/agenda/AgendaPage.tsx` (+ `AgendaItem`): botão "Enviar mensagem" ao lado de "Editar"/"Mudar status", gated por `canSendWhatsAppMessage`, abrindo o `SendMessageDialog` com `appointmentId` + `customerId` + `whatsapp_opt_in` do agendamento. O `professional` só vê a ação nos agendamentos que o RLS já filtra.
   - `src/app/clientes/ClientesPage.tsx`: ação "Enviar mensagem" por cliente, gated igual, abrindo o diálogo com `customerId` (+ `whatsapp_opt_in`), sem `appointmentId`.

3. **Opt-in na borda (defesa em profundidade)**: quando o cliente alvo tem `whatsapp_opt_in === false`, o botão/ação "Enviar" fica **desabilitado** com explicação pt-BR ("Este cliente não autorizou receber mensagens no WhatsApp.") e atalho para a tela de Clientes (onde o consentimento é editado). O flag já vem na leitura de `customers`/join da agenda — sem request extra. A trava real continua no servidor (ADR-04).

4. **Acessibilidade**: `DialogTitle`/`DialogDescription` ligados por aria; `<label>` associado ao `select`; botão desabilitado comunica o porquê por texto adjacente (não só `disabled`); navegação por teclado e foco visível preservados pelos primitivos shadcn.

5. **PII**: a ação não renderiza telefone/corpo com PII; identifica o destino pelo nome do cliente. O gancho comentado "ao concluir → cobrança" em `StatusChangeConfirm` **permanece só comentário** (trava negativa).

## Consequências

- Fecha o fluxo ponta-a-ponta da fase (conectar → enviar → logar) na UI.
- O `SendMessageDialog` reusado por Agenda e Clientes evita duplicação.
- A idempotência torna o retry seguro; a UI reflete `duplicate` como no-op benigno.
- O opt-in desabilitado na borda evita round-trip inútil e deixa a causa óbvia, sem enfraquecer a trava do servidor.

## Arquivos afetados

- `src/app/whatsapp/SendMessageDialog.tsx` (novo)
- `src/app/agenda/AgendaPage.tsx` (modificar — gatilho + diálogo)
- `src/app/agenda/AgendaItem.tsx` (modificar — botão "Enviar mensagem") *(se o item for componente separado; senão, dentro de `AgendaPage`)*
- `src/app/clientes/ClientesPage.tsx` (modificar — ação por cliente)

## Critérios de aceite testáveis (desta ADR)

- **A1.** `npm run build` e `npm run typecheck` limpos, sem `any` (CA-16, CA-F11).
- **A2.** Em agenda/cliente com `whatsapp_opt_in=true`: "Enviar mensagem" abre o diálogo, confirma, toast "Mensagem enviada."; o histórico recente ganha linha "Enviado" (CA-F04, CA-15).
- **A3.** Com `whatsapp_opt_in=false`: botão "Enviar" desabilitado com explicação pt-BR; se forçado, bloqueio pt-BR do servidor e nenhuma mensagem "enviada" (CA-F05).
- **A4.** Reenviar o mesmo template para o mesmo agendamento/cliente mostra toast informativo "já enviada" e **não** cria 2ª linha no histórico (CA-F06, CA-19 idempotência visível).
- **A5.** Nenhuma invocação envia `tenant_id` (só `action`/`template`/ids) (CA-F10, CA-21).
- **A6.** Diálogo navegável por teclado, foco visível, labels associados, pt-BR (CA-F09, CA-F12). QA via Chrome DevTools cobre o fluxo enviar (OK, opt-in, duplicado) sem erro de console.
- **A7.** `grep` confirma que o gancho "ao concluir → cobrança" em `StatusChangeConfirm` segue só comentário; nenhum `charges`/PIX/Asaas introduzido (CA-18, CA-22).
