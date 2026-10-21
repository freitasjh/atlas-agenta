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

Alteração principal em `src/app/whatsapp/SendMessageDialog.tsx` (ver "Arquivos afetados" para os
arquivos de apoio tocados por paridade de contrato):

1. As **opções** do `Select` de template vêm da lista **fechada** `MESSAGE_TEMPLATES`
   (`src/types/domain.ts`) — domínio fixo das 4 chaves —, **não** da leitura de `message_templates`.
   Isso **desacopla o envio da leitura de templates**: a RLS concede `SELECT` só ao `admin`, então
   `receptionist`/`professional` (que **podem** disparar — `canSendWhatsAppMessage`) recebem zero
   linhas do fetch; derivar as opções do enum garante que todos os papéis que podem enviar vejam as
   4 chaves. `useMessageTemplates()` (ADR-05) é usado **apenas para enriquecer o preview** quando as
   linhas existem (admin).
2. Abaixo do `Select`, quando existir a linha do template para o tenant (admin), renderizar um bloco
   de preview via `segmentTemplate(body, vars)` (ADR-03) com realce de token por fundo (texto em
   `foreground`, igual à ADR-06). Variáveis do preview: `{nome}` = `customerName`; `{empresa}` =
   `trade_name` → `legal_name` → fallback (mesmo encadeamento do servidor, via `resolveEmpresa`).
   **`{servico}`/`{dataHora}` ficam no fallback pt-BR do preview** — o diálogo recebe só
   `appointmentId`, não os dados do agendamento; o servidor (ADR-04) resolve serviço/data reais no
   envio e é a fonte da verdade. O preview cobre nome/empresa; serviço/data aparecem como fallback
   previsível (decisão consciente, alinhada ao item 4 da review).
3. **O envio nunca é desabilitado por ausência de linha de template.** A trava de ativo/inativo e o
   fallback de template ausente são do servidor (ADR-04 → `DEFAULT_TEMPLATE_BODIES`); desabilitar na
   UI por `!selectedRow` travaria `receptionist`/`professional` (sem `SELECT` por RLS) e o `admin` de
   tenant legado sem seed — recriando a regressão de envio (RF-T07/RF-T08). O `Select` desabilita
   apenas sem opt-in; `sendDisabled = !whatsappOptIn || isPending`. Sem mudar o shape do payload nem
   os 5 outcomes.

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

- `src/app/whatsapp/SendMessageDialog.tsx` (modificar — bloco de preview; opções do `Select` pela
  lista fechada `MESSAGE_TEMPLATES`; envio desacoplado da leitura de templates)

Arquivos de apoio tocados por paridade de contrato (desvio do escopo original "alterar apenas
`SendMessageDialog.tsx`", registrado aqui conforme item 3 da review — mudanças pequenas e
verificadas, não antecipam ADRs futuras):

- `src/lib/message-templates.ts` (extração de `segmentTemplate` + `resolveEmpresa` — contrato
  compartilhado cliente↔servidor da ADR-03, reusado pelo preview)
- `src/app/config/mensagens/TemplatePreview.tsx`, `src/app/config/mensagens/TemplateEditorDialog.tsx`
  (consomem o contrato extraído — paridade com o preview do editor, ADR-06)
- `src/hooks/useTenant.ts` (expõe `trade_name`/`legal_name` para o `{empresa}` do preview)
- `src/types/domain.ts` (tipos de apoio do contrato de templates)

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
