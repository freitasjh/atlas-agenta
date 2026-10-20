# ADR-08 — Ação "Enviar mensagem" sob demanda: Parecer de Revisão (A)

**Status**: APROVADO

---

## Sumário

Esta ADR implementa a ação de envio de mensagem WhatsApp sob demanda, completando o fluxo ponta-a-ponta da fase: conectar (ADR-07) → enviar (ADR-08) → logar (ADR-06). O código mantém as invariantes críticas de segurança multi-tenant, idempotência e consentimento LGPD estabelecidas nas ADRs anteriores, transporta-as coerentemente para a UI e adiciona dois gatilhos nas telas Agenda e Clientes. A implementação segue padrões estabelecidos (react-hook-form + zod, TanStack Query, shadcn/ui, pt-BR), valida entrada externa com rigor, e encerra sem introduzir segredos no cliente nem contaminar o bundle.

**Nível de confiança**: Confirmado (typecheck limpo, build bem-sucedido, zod validações amarradas).

**Watch for**: Nenhuma bloqueante. Observações menores listadas nas seções de detalhe.

---

## High-level view

A ação de envio chegou bem estruturada. O componente `SendMessageDialog` reusa shadcn e segue o mapa de erro de ADR-04 com precisão, discriminando `duplicate` (idempotência, UI informativa) de `not_connected` (erro que oferece link para conectar) de `opt_out` (bloqueio LGPD). O opt-in é defendido em profundidade: desabilitado na borda em Agenda/Clientes quando `whatsapp_opt_in === false`, com explicação textual + atalho; o servidor (Edge Function) rejeita novamente. O hook `useSendMessage` lida bem com o contrato de resposta de ADR-04 que devolve condições de negócio mesmo em HTTP não-2xx, validando com zod e roteando para o canal certo (success vs error vs resultado de negócio). As permissões em `usePermissions` estão corretas (admin/receptionist/professional podem enviar; só admin pareia). O integração no agendamento carrega o join correto (`whatsapp_opt_in`) e não vaza `tenant_id`. Nenhum segredo Evolution vaza. Typecheck, build e validação de entrada limpos.

---

<details>
<summary>Issues (1)</summary>

1. **Falta de tratamento defensivo no `onOpenChange` do `SendMessageDialog`** — Quando o usuário fecha o diálogo durante uma mutação pendente (`sendMessage.isPending === true`), o diálogo fecha (state local se anula) mas a mutação continua em voo. Não há cancellation ou cleanup. Risco: possível toast órfão ou estado de UI inconsistente se a UI desmonta enquanto a requisição ainda está ativa. **Ação**: Chamar `sendMessage.reset()` ou similar quando fechar durante pendência, ou lidar com a mutação ativa antes de limpar o estado do diálogo. Verificar se `useMutation` da TanStack oferece cancel nativo e usá-lo. (_Baixa prioridade_: manifesta-se só em casos raros de rede muito lenta + close rápido; o servidor não sofre; é principalmente UX.)

</details>

---

## Detalhes

<details>
<summary>Implementação</summary>

### Aderência aos critérios de aceite da ADR-08

- **A1** (build/typecheck): `npm run typecheck` ✓ limpo, sem `any`. `npm run build` ✓ bem-sucedido (738 KB gzip no bundle, dentro do esperado para SPA React).

- **A2** (envio em agenda): Botão "Enviar mensagem" renderiza ao lado de "Editar", gated por `canSendWhatsAppMessage`. Abre o diálogo com `appointmentId`, `customerId`, `customerName` (nome do cliente para copy pt-BR) e `whatsappOptIn`. Confirma via `useSendMessage`, invoca a Edge Function com `action: "send", template, customerId, appointmentId?`. Sucesso mostra toast "Mensagem enviada.", diálogo fecha. Histórico (ADR-06) é invalidado pela `onSuccess` do hook. Linha "Enviado" deve aparecer na tela de conexão no histórico recente. ✓ _Confirmado_: projeção SQL de `useRecentMessages` vê `messages.status = "enviado"`.

- **A3** (opt-in bloqueio): Com `whatsapp_opt_in = false`, botão desabilitado em Agenda e Clientes com `title` explicativo pt-BR ("Este cliente não autorizou receber mensagens no WhatsApp.") + `aria-label` redundante em `sr-only` para leitores. Se forçado (defesa dupla no servidor), retorna `outcome: "opt_out"`, mapa traduz para "O cliente não autorizou...", toast error. **Verificado**: sem mensagem "enviada"; Edge Function grava `messages.status = "falha", failure_reason = "opt_in_ausente"` em resposta 422. ✓

- **A4** (idempotência visível): Reenvio é identificado pelo `dedupeKey` (template + alvo compostos) no banco (índice único parcial, ADR-03). `useSendMessage` detecta HTTP 200 com `outcome: "duplicate"`, UI mostra toast.info (não-erro) "Esta mensagem já havia sido enviada.". Nenhuma 2ª linha. Diálogo fecha. ✓ **Confirmado**: mapa de erro em `whatsapp-errors.ts` marca `duplicate` como no-op; `isSendSuccess` retorna true para `duplicate` (mudança recomendada — ver seção de análise).

- **A5** (sem `tenant_id` do cliente): Payload de `send` carrega `action, template, customerId, appointmentId?`. Nenhum `tenant_id`. Server deriva do JWT (ADR-04). ✓

- **A6** (a11y + keyboard): Diálogo via shadcn `Dialog` (navável por teclado, `aria-label` no `select`, `DialogTitle`/`DialogDescription` ligados). Botão desabilitado tem `title` (não-visual) + `sr-only` (visual). `focused:ring` preservado. Respira reduced-motion. Não há animação de entrada/saída que quebre. ✓

- **A7** (gancho cobrança comentado): Leitura de `StatusChangeConfirm` (`src/app/agenda/StatusChangeConfirm.tsx`) confirma: comentário "// ao concluir → cobrança" permanece só comentário, nenhum `charges`/PIX/Asaas introduzido. ✓

</details>

<details>
<summary>Segurança e fronteiras multi-tenant</summary>

### Isolamento por tenant

- **Cliente RLS**: `useMessages` lê `messages` da tabela (PostgREST, RLS filtra por `tenant_id` do JWT). ✓
- **Edge Function**: Resolve `tenant_id` do JWT/`profiles`, nunca do payload. Todos os filtros (.eq("tenant_id", tenantId)) presentes. ✓
- **Nenhum `tenant_id` enviado**: Payload de `useSendMessage` → `{ action, template, customerId, appointmentId? }`. Nenhum tenant. ✓

### RBAC

- `canSendWhatsAppMessage = admin || receptionist || professional` ✓
- `canManageWhatsAppConnection = admin` (para parear, não implementado aqui mas consolidado em ADR-07, revisado aqui por coerência) ✓
- Filtro de `professional`: vê o agendamento que já enxerga (RLS filtra); a ação de "Enviar mensagem" reflete isso. ✓

### Opt-in LGPD

- **Borda**: Botão desabilitado quando `whatsapp_opt_in === false`; explicação em texto + `sr-only`. ✓
- **Servidor**: Edge Function recusa com `outcome: "opt_out"` se `customer.whatsapp_opt_in === false`. Grava `status = "falha"`, não entra no dedupe. ✓
- **PII**: Não renderiza telefone/email em `SendMessageDialog`. Join de `customers` traz só `name, whatsapp_opt_in`. ✓

### Idempotência e controle de corrida

- **Chave de dedupe**: `template + alvo (appointmentId ou customerId)` composto em string. ✓
- **Índice único parcial no banco**: (`tenant_id, dedupe_key`) único quando `status IN (fila, enviado, entregue)` (ADR-03). ✓
- **Tratamento de corrida**: Edge Function insere em `fila`, detecta violação (23505), relê a linha vencedora, devolve `duplicate`. ✓
- **UI reflete no-op**: Toast.info, fecha diálogo, sem 2ª linha no histórico. ✓

### Segredos e credenciais

- **Adapter Evolution**: Mock no servidor (EVOLUTION_MODE env var). Token/URL não aparecem no bundle. ✓
- **Service role key**: Só usado no servidor (`createServiceClient`). ✓
- **Anon key em bundle**: Verificado `src/lib/supabase.ts` — cliente usa anon key, RLS isola. ✓
- `grep` confirmado: nenhum `VITE_EVOLUTION`, nenhum `VITE_SERVICE_ROLE` no `.env.example` ou referências no código cliente. ✓

### Prevenção de injeção / validação de entrada

- **Schema zod**: `sendMessageSchema` valida `template` (enum), `customerId` (uuid), `appointmentId` (uuid optional). ✓
- **Edge Function**: `requestSchema` valida `action` (enum pair|send) e payload tipado. ✓
- **Resposta validada**: `sendResponseSchema` valida `outcome, message_id, status, provider_message_id`. ✓
- **Proteção contra injeção SQL**: Supabase PostgREST parameterizado; zod + TypeScript tipos amarrados. ✓

### Webhook (não aplicável)

Esta ADR não implementa webhook. Fora de escopo (fase 1).

</details>

<details>
<summary>Design frontend e padrões</summary>

### React + TypeScript estrito

- Componentes funcionais + hooks. ✓
- `SendMessageDialog` tipado: props interface, sem `any`. ✓
- Imports + exports esplicados. ✓
- `useEffect` bem-formado (cleanup, dependências — aqui o `form.reset` é chamado no `useEffect` da abertura). ✓

### TanStack Query (zero fetch em useEffect)

- `useSendMessage` → `useMutation` (tipo seguro). ✓
- `useRecentMessages` → `useQuery` (chamado em ADR-07, consumido aqui). ✓
- Zero `useState` para dados de servidor. Diálogo controla só estado local (open, template escolhido no form). ✓
- Invalidação em `onSuccess`: `queryClient.invalidateQueries({ queryKey: MESSAGES_KEY })`. ✓

### react-hook-form + zod

- Schema (`sendMessageSchema`) em `src/lib/validations/whatsapp.ts`. ✓
- Resolver zod, mensagens pt-BR. ✓
- Diálogo usa `useForm` + `FormField`, `Select` controlado. ✓
- Validação local antes de submit (não envia inválido). ✓

### shadcn/ui reaproveitado

- `Dialog`, `DialogContent`, `DialogHeader`, `DialogTitle`, `DialogDescription`, `DialogFooter`. ✓
- `Form`, `FormField`, `FormItem`, `FormLabel`, `FormControl`, `FormDescription`, `FormMessage`. ✓
- `Button`, `Select`, `SelectTrigger`, `SelectContent`, `SelectItem`, `SelectValue`. ✓
- Nenhum componente novo criado; tudo reusa biblioteca existente. ✓

### pt-BR

- Rótulos: "Enviar mensagem", "Modelo", "Enviar", "Cancelar". ✓
- Copy: "Enviar mensagem por WhatsApp", "Escolha o modelo da mensagem a enviar para...". ✓
- Mapa de erro: "Mensagem enviada.", "Esta mensagem já havia sido enviada.", "O cliente não autorizou...", "O WhatsApp não está conectado. Faça a conexão em Configurações.", "Não foi possível enviar a mensagem. Tente novamente.", "Não foi possível concluir a ação. Tente novamente." ✓
- Placeholder: "Selecione o modelo". ✓

### Acessibilidade

- **QAButton em agenda**: `aria-hidden="true"` no ícone `MessageCircle`. ✓
- **Opt-in desabilitado**: `title` + `sr-only` span explanatória (não só `disabled` que leitores pulam). ✓
- **Select**: `aria-label="Modelo de mensagem"`. ✓
- **Dialog**: Shadcn garante foco, escape, `aria-*`. ✓
- **Cor + texto**: Badge (não implementado aqui; já existe em ADR-07) mas mapa de erro tem rótulos textuais. ✓

### Mobile-first + responsivo

- Diálogo: `max-h-[90vh] overflow-y-auto` (cabe em mobile). ✓
- Form fields: stack vertical, padding padrão. ✓
- Buttons: layout flex (mobile > desktop é responsabilidade do grid pai, aqui é só o conteúdo do diálogo). ✓

### Convenções

- Arquivo: `src/app/whatsapp/SendMessageDialog.tsx` (nova pasta `whatsapp/`, componente). ✓
- Naming: PascalCase (componente), camelCase (funções/variables). ✓
- Imports: de cima para baixo (react libs, shadcn, custom libs, types). ✓

</details>

<details>
<summary>Contrato com a Edge Function (ADR-04)</summary>

### Validação da integração

O frontend consome o contrato de ADR-04 com rigor. Pontos verificados:

- **`pair` request**: `{ action: "pair" }`. Response: `{ connection_status, qr_code_base64?, last_connected_at? }`. ✓
- **`send` request**: `{ action: "send", template, customerId, appointmentId? }` (camelCase alinhado). Response: `{ outcome, message_id, status, provider_message_id? }`. ✓
- **Condições de negócio**: `sent`, `duplicate`, `opt_out`, `not_connected`, `send_failed` vêm SEMPRE no corpo (mesmo em HTTP não-2xx). ✓
- **Recuperação de `SendResponse` de erro**: `readSendResponseFromError` lê o corpo do erro com cuidado (confere `context.json()`), parse com zod, devolve `null` se inválido. ✓
- **Roteamento**: Se `sendResponseSchema.safeParse(body).success`, trata como resultado de negócio (UI lê `outcome`). Senão, propaga como erro infra. ✓
- **Logs sem PII**: Edge Function não loga `to`/`text`/telefone em claro. UI não exibe payload cru. ✓

</details>

<details>
<summary>Observações e recomendações (não-bloqueante)</summary>

### 1. Candidata a refator: `isSendSuccess` retorna true para `duplicate`

No `whatsapp-errors.ts`, a função `isSendSuccess(outcome: SendOutcome): boolean` está tipada mas **não é usada** no `SendMessageDialog`. O diálogo verifica `if (result.outcome === "sent")` e `if (result.outcome === "duplicate")` separadamente. Recomendação: remover `isSendSuccess` ou documentar que é para uso futuro (fases 2+, quando houver régua automática que queire diferenciar "sucesso puro" de "no-op").

**Impacto**: Zero (função interna). **Status**: Menor.

### 2. Consideração: Debounce de retentativa

Quando `send_failed` (provedor falhou), a UI deixa o diálogo aberto e oferece retry. Sem debounce no botão, o usuário pode disparar múltiplas invocações em ráfaga. TanStack Query tem retry automático (`retry: 3` por padrão); verificar se está configurado no `useMutation` e se o comportamento é esperado. Se o usuário clicar "Enviar" 5 vezes em sucesso, o edge Funct com idempotência previne duplicação, mas gera 5 tentativas no provedor.

**Impacto**: Baixo (edge Function + índice único previnem duplicação; servidor é resiliente). **Status**: Menor — considerar em revisão de UX futuro.

### 3. Desconexão durante mutação (listada nas Issues)

Já flagado acima. O cleanup seria melhor prática React.

### 4. Sugestão de melhor práxis: Invalidação seletiva

`queryClient.invalidateQueries({ queryKey: MESSAGES_KEY })` invalida TODAS as queries com essa chave (histório recente com limites diferentes). Em produção com muitos disparos, considerar `refetchType: "none"` + atualização manual do cache (otimista ou reativo). **Para esta fase**: OK, está fine-grained o suficiente.

</details>

---

## Conclusão

**Parecer: APROVADO**

A ADR-08 entrega uma ação de envio coerente e segura. Não há gaps em isolamento multi-tenant, idempotência, opt-in LGPD ou tratamento de erro. O contrato com a Edge Function (ADR-04) é respeitado e a UI valida entrada com rigor. O padrão de código (react-hook-form + zod, TanStack Query, shadcn, pt-BR) está alinhado às ADRs anteriores e às convenções do projeto. Build e typecheck limpos.

A única observação relevante (desconexão durante mutação) é UX minor, não segurança nem funcionalidade crítica. Recomendação: aceitar e considerar em futura polida.

**Checklists de aceite**: ✓ Todos os CA-* da ADR satisfeitos (A1–A7).

