# ADR-07 — Preview no `SendMessageDialog` + QA ao vivo da fatia

**Status:** proposto

**Escopo:** frontend

**Depende de:** ADR-03 (`renderTemplate` + fallback para o preview), ADR-05
(`useMessageTemplates`), ADR-06 (a tela de edição existe), ADR-04 (a renderização canônica do
servidor — o preview é defesa em profundidade; a prova de ponta usa o servidor). É a **última** ADR:
fecha a verificação ao vivo da fatia inteira.

## Contexto

O `SendMessageDialog` (`src/app/whatsapp/SendMessageDialog.tsx`, reusado por Agenda e Clientes)
continua funcionando igual — escolhe template, confirma, invoca a Edge Function; o **contrato de fio
de `send` não muda** (`{ action, template, customerId, appointmentId? }`). A única adição é um
**bloco de preview** do texto renderizado que será enviado, para tornar o critério central ("o envio
usa o template renderizado") visível e verificável na UI (§1.6 de `analysis-frontend.md`). O preview
é derivado do mesmo template (`useMessageTemplates`) + dados já disponíveis no diálogo
(`customerName` já é prop; `{servico}`/`{dataHora}` vêm do agendamento quando `appointmentId`
existe) via `renderTemplate` (ADR-03). A renderização **real** é do servidor (ADR-04) — o preview
nunca é a fonte da verdade do envio.

## Decisão

Alterar **apenas** `src/app/whatsapp/SendMessageDialog.tsx`:

1. Ler os templates do tenant via `useMessageTemplates()` (ADR-05).
2. Abaixo do `Select` de template, renderizar um bloco de preview (`renderTemplate(body, vars)`,
   ADR-03) com os dados disponíveis: `{nome}` = `customerName`; `{empresa}` = `trade_name` do tenant
   (via `useTenant`); `{servico}`/`{dataHora}` quando o diálogo tiver o agendamento de origem (caso
   contrário, o fallback aparece — deixando explícito ao admin que não haverá `{dataHora}` cru).
   Mesmo tratamento de realce de token por fundo (texto em `foreground`) da ADR-06.
3. Se o template da chave estiver **inativo**, o `Select` não o oferece; se não houver ativo para a
   chave, explicar em pt-BR e desabilitar o envio daquela chave (defesa em profundidade; a trava
   final é do servidor). Sem mudar o shape do payload nem os 5 outcomes.

Nenhuma mudança no `useSendMessage`, no schema `sendMessageSchema`, nos DTOs de `src/lib/whatsapp.ts`
nem nos outcomes — o envio permanece intacto (AC-07).

Esta ADR também concentra o **QA ao vivo da fatia** (AC-10): ambiente local `supabase start`;
`supabase functions serve whatsapp --env-file supabase/functions/.env`; `npm run dev`.

## Consequências

- O admin vê, antes de disparar, o texto renderizado que o cliente receberá — com fallback visível
  quando falta dado.
- O envio continua com o mesmo contrato e os mesmos 5 outcomes; o preview é só camada de confiança.
- A fatia fica verificável ponta a ponta: editar na tela (ADR-06) + disparar (aqui) + confirmar o
  texto renderizado (servidor, ADR-04).

## Arquivos afetados

- `src/app/whatsapp/SendMessageDialog.tsx` (modificar — adicionar o bloco de preview)

## Critérios de aceite (testáveis nesta ADR)

- **Build:** `npm run build` limpo.
- **§8.5 / AC-05 / AC-07 (QA ao vivo, chrome-devtools):** no diálogo de Enviar mensagem (Agenda/
  Clientes), ao escolher um template aparece o preview do texto renderizado; o envio continua
  funcionando com os 5 outcomes inalterados (`sent|duplicate|opt_out|not_connected|send_failed`); o
  texto efetivo entregue ao adapter é o **template renderizado**, não a string crua da chave.
- **Fluxo completo da fatia (AC-10):** admin edita um template em `/app/config/mensagens`, dispara
  "Enviar mensagem" e confirma que o texto enviado é o renderizado — **sem erro de console**.
- **Isolamento/Acessibilidade (§8.6/§8.7):** preview por tenant correto; `Esc` fecha o diálogo e
  devolve foco; contraste do preview conferido (realce por fundo).
- Verificar: `npm run build` exit 0; QA ao vivo cobre os itens acima. Clean-up de quaisquer arquivos
  temporários de teste.
