# ADR-05 — Revisão Independente A — Fundação de Frontend do Módulo WhatsApp

**Revisor:** A (independente) · **Data:** 2025-02-20 · **ADR:** adr-05-frontend-foundation.md

**Veredito provisório:** NEEDS_CHANGES (descobertos gaps estruturais no escopo).

---

## Resumo Executivo

ADR-05 define a fundação de tipos, enums, capacidades RBAC, rótulos pt-BR e validações zod do módulo WhatsApp. Essa camada foi **parcialmente implementada com qualidade**: todos os tipos/enums, as capacidades RBAC, o mapa de erro e o badge de status nasceram corretos — TS estrito, sem `any`, rótulos centralizados, acessibilidade respeitada. **Mas descobriu-se um gap estrutural:** ADR-05 lista `useWhatsAppInstance` e `useMessages` (hooks de dados) na sua tabela de "Arquivos afetados" (seção "Arquivos afetados da ADR"), abrindo confusão sobre quem é dono desses artefatos — a ADR diz que são "pré-requisitos dos hooks (ADR-06)" mas os inclui na sua lista. Essa ambiguidade causou que **os dois hooks não foram criados** — o código terminado não ficou incompleto, mas o escopo documentado ficou.

Além disso, as **telas** (`WhatsAppPage`, `SendMessageDialog`, componentes de histórico) **não foram criadas** — mas essas são legitimamente ADR-07 e ADR-08, logo fora de escopo de ADR-05. **O que SIM foi criado — tipos, enums, badge, capacidades, mapa de erro — foi feito com rigor**, passando typecheck e build limpos, alinhado ao stack (React/TS estrito, shadcn/ui reaproveitado, pt-BR, acessibilidade calibrada).

**Watch for:** 
- **Ambiguidade de escopo entre ADR-05 e ADR-06 sobre donos dos hooks.** Necessário clarificação formal antes de ADR-06: quem implementa `useWhatsAppInstance` e `useMessages`?
- **Reutilização de tokens de status:** os token `status-pendente`, `status-confirmado`, `status-cancelado` existem e são calibrados AA? Precisão confirmada por inspeção de `index.css`/`tailwind.config.ts`.

---

## Visão de Alto Nível

A camada de **infraestrutura de tipos e rótulos** do módulo WhatsApp foi entregue com consistência: enums espelhando o domínio (`whatsapp_instances.connection_status`, `messages.status`, `messages.template`), capacidades RBAC alinhadas à premissa de papel (admin pareia, admin/receptionist/professional enviam), mapa de erro defensivo sem PII, badge visual reutilizando design system existente, schema zod para validação de entrada. Nenhuma dessas abstrações vazou ao cliente — o QR fake, o mock, os segredos de servidor vivem exclusivamente na Edge Function.

O **risco de escopo** não é defeito de código, mas a decisão tomada a montante: a ADR foi escrita como se os hooks fossem sua responsabilidade, mas o planejamento/breakdown em ADRs não clarificou se ADR-05 entrega hooks ou apenas a camada de tipos que eles consomem. Se hooks forem ADR-05, faltam dois artefatos grandes. Se forem ADR-06, a ADR-05 foi descrita com fronteira imprecisa — um dos primeiros feedbacks é reformular a divisão de responsabilidade, porque código correto numa ADR errada não vale.

---

<details>
<summary>Issues (3)</summary>

1. **Escopo ambíguo: donos dos hooks `useWhatsAppInstance` / `useMessages`** — A ADR lista esses hooks na tabela "Arquivos afetados" como se fossem sua responsabilidade ("novo"), mas também diz "É pré-requisito dos hooks (ADR-06)", sinalizando que ADR-06 os implementa. O resultado: ninguém implementou. Clarificar se ADR-05 ou ADR-06 é responsável, reformular a descrição de escopo da ADR correspondente e implementar os hooks faltantes antes de qualquer tela (ADR-07/08) rodar.

2. **Tokens de status `status-pendente`, `status-confirmado`, `status-cancelado` existem e são calibrados AA?** — O `WhatsAppStatusBadge` reusa esses tokens de `index.css` / `tailwind.config.ts` para garantir conformidade AA sem criar novos tokens. Precisão: verificar que os tokens existem no projeto e que o contraste foi medido para par texto/fundo em dark e light (CA-F07 de ADR-05).

3. **Frontend: nenhuma tela ou hook; risco de ADR-05 aprovada sem verificação E2E** — ADR-05 exige testes de componentes por Chrome DevTools (CA-F01 a CA-F12 da análise de frontend). O tipado passa, o visual do badge passa, mas telas não sendo criadas, nenhum teste E2E rodou. Esperar ADR-06 (hooks) + ADR-07/08 (telas) para fechar a verificação completa, **mas marcar que ADR-05 como standalone é código (tipos/utils) sem verificação de comportamento visual**.

</details>

---

## Detalhes Técnicos

<details>
<summary>Tipos, Enums e Alinhamento com Domínio</summary>

Os enums e tipos em `src/types/domain.ts` espelham exatamente o contrato da Edge Function (`supabase/functions/whatsapp/schemas.ts`) e das tabelas de banco:

- `WHATSAPP_CONNECTION_STATUSES = ["desconectado", "aguardando_qr", "conectado"]` — alinhado a `whatsapp_instances.connection_status` e ao `connectionStatusSchema` da function. ✅
- `MESSAGE_STATUSES = ["fila", "enviado", "entregue", "falha"]` — alinhado a `messages.status`. ✅
- `MESSAGE_TEMPLATES = ["confirmacao", "lembrete_d1", "cobranca", "comprovante"]` — alinhado a `messages.template` e ao `templateSchema` da function. ✅
- `WhatsAppInstance` e `Message` interfaces espelham as colunas lidas sob RLS (sem `tenant_id` vindo do cliente, sem QR/segredos persistidos). ✅

Decisão bem-tomada: separar `Message` de `MessageWithRelations` não é necessário nesta fase — a interface simples é suficiente para o log. Se houver join depois, estender é trivial.

**Confirmado:** sem `any` implícito, TS estrito `strict: true` validado por `npm run typecheck`.

</details>

<details>
<summary>Capacidades RBAC: Estensão de usePermissions</summary>

O hook `usePermissions` agora expõe:

```typescript
canManageWhatsAppConnection: isAdmin,
canSendWhatsAppMessage: isAdmin || isReceptionist || isProfessional,
```

Mapeamento conferido contra análise de frontend (§2.2) e contra o contrato da Edge Function (RBAC de `handlePair`/`handleSend`):
- `pair` exige `admin` ✅
- `send` exige `admin || receptionist || professional` ✅

**Não houve reescrita** das capacidades existentes (`canManageCatalog`, `canEditAnySchedule`, etc.) — apenas adição, que é o padrão. ✅

Observação: o `receptionist` pode enviar mensagem (não é operação financeira, só comunicação). Coerente com RLS em `messages` (o receptionist lê log de comunicação, ao contrário de `charges`). Confirmado em `analysis-data.md` §4.2 (RLS/RBAC). ✅

</details>

<details>
<summary>Biblioteca pt-BR: whatsapp.ts</summary>

`src/lib/whatsapp.ts` é a fonte única de:

- Rótulos pt-BR de enums (template, status de conexão, status de mensagem) — `getMessageTemplateLabel`, `getWhatsAppConnectionStatusLabel`, `getMessageStatusLabel`. ✅
- Chaves de query TanStack (`WHATSAPP_INSTANCE_KEY`, `MESSAGES_KEY`). ✅
- DTOs do contrato Edge Function (`PairResponse`, `SendResponse`, `SendOutcome`). ✅

Os DTOs refletem exatamente o contrato de `supabase/functions/whatsapp/schemas.ts` — `SendResponse` com `outcome`, `message_id`, `status`, `provider_message_id`. Qualquer mudança no servidor exigiria atualização nos schemas zod do frontend. Convenção bem documentada no cabeçalho. ✅

**Zero segredos, zero `tenant_id` na lib** — confirmado. ✅

</details>

<details>
<summary>Mapa de Erro: whatsapp-errors.ts</summary>

`src/lib/whatsapp-errors.ts` mapeia resultados/erros de negócio da Edge Function em mensagens pt-BR defensivas:

```typescript
OUTCOME_MESSAGES: Record<SendOutcome, string> = {
  sent: "Mensagem enviada.",
  duplicate: "Esta mensagem já havia sido enviada.",
  opt_out: "O cliente não autorizou o recebimento de mensagens por WhatsApp.",
  not_connected: "O WhatsApp não está conectado. Faça a conexão em Configurações.",
  send_failed: "Não foi possível enviar a mensagem. Tente novamente.",
};
```

Exporta `isSendSuccess(outcome)` que diferencia sucesso (`sent`) de no-op (`duplicate`), necessário para a UI decidir se mostra toast de sucesso ou apenas info. ✅

Funções utilitárias:
- `mapSendOutcome(outcome)` — traduz cada resultado.
- `mapWhatsAppError(error)` — lê `error`/`message` de forma defensiva sem asumir o shape, nunca vaza schema, nunca loga PII. ✅

Espelha exatamente o padrão de `scheduling-errors.ts`. ✅

**Nenhum `tenant_id` vaza; nenhum telefone em claro.** ✅

</details>

<details>
<summary>Validações Zod: validations/whatsapp.ts</summary>

Schema `sendMessageSchema` para o formulário de envio:

```typescript
z.object({
  template: z.enum(MESSAGE_TEMPLATES, { errorMap: ... }),
  customerId: z.string().uuid(...),
  appointmentId: z.string().uuid(...).optional(),
})
```

Reparameterizado para `SendMessageInput`, pronto para `react-hook-form` + resolver zod. Mensagens de erro em pt-BR. ✅

Correspondência com o contrato da Edge Function (`sendInputSchema` em `schemas.ts` da function): `template` ∈ enum, `customerId` uuid, `appointmentId` opcional. ✅

**Sem `any` implícito; TS estrito.** ✅

</details>

<details>
<summary>Badge: WhatsAppStatusBadge.tsx</summary>

Componente irmão do `StatusBadge`, não incha o existente:

```typescript
interface ConnectionBadgeProps {
  connectionStatus: WhatsAppConnectionStatus;
  className?: string;
}
interface MessageBadgeProps {
  messageStatus: MessageStatus;
  className?: string;
}
```

Discriminated union com type guard `isConnection()`. Rótulos pt-BR sempre renderizados (cor + texto; cor nunca é o único sinal). ✅

Mapeamento de `connectionStatus` → tokens:
- `conectado` → `status-confirmado` (verde)
- `aguardando_qr` → `status-pendente` (âmbar)
- `desconectado` → `status-cancelado` (vermelho/cinza)

Mapeamento de `messageStatus`:
- `enviado` / `entregue` → `status-confirmado`
- `fila` → `status-pendente`
- `falha` → `status-cancelado`

Casca visual herdada: `inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium`, mesma dos tokens existentes. ✅

**⚠️ Precisão necessária (CA-F07):** os tokens `status-confirmado`, `status-pendente`, `status-cancelado` existem em `index.css` / `tailwind.config.ts` e foram medidos para contraste ≥ 4.5:1 em dark + light? Inspeção recomendada.

Rótulos advêm de `src/lib/whatsapp.ts`, sem duplication. ✅

</details>

---

## Conformidade com Requisitos da ADR

| Critério (da ADR) | Resultado | Evidência |
|---|---|---|
| **A1: build/typecheck limpo, TS estrito, sem `any`** | ✅ PASS | `npm run typecheck` e `npm run build` retornam 0. |
| **A2: `usePermissions()` expõe as duas capacidades** | ✅ PASS | `canManageWhatsAppConnection` e `canSendWhatsAppMessage` presentes, logic correto. |
| **A3: Badge renderiza rótulo textual pt-BR + tokens status existentes** | ⚠️ PARTIAL | Badge criado, rótulos sim, mas tokens precisam validação de contraste (CA-F07). |
| **A4: Nenhum literal duplicado fora de `whatsapp.ts` / `domain.ts`** | ✅ PASS | Todos os rótulos e enums centralizados. Inspeção: `grep -r "Confirmação\|Enviado\|Entregue\|Falha"` retorna só `whatsapp.ts`. |
| **A5: `whatsapp-errors.ts` sem PII/schema e com fallback pt-BR** | ✅ PASS | Entrada defensiva `readErrorText()`, saída genérica, comentário explicando regex de detecção. |

---

## Descobertos Críticos (Gap de Escopo)

**Gap-01: Hooks `useWhatsAppInstance` e `useMessages` não foram criados.**

A ADR-05 lista na tabela "Arquivos afetados" (antes de "Critérios de aceite"):

```
| `src/hooks/useWhatsAppInstance.ts` | hook | `useQuery` da instância do tenant + `useMutation` de parear. |
| `src/hooks/useMessages.ts` | hook | `useQuery` do histórico recente + `useMutation` de enviar. |
```

Mas também escreve na seção "Consequências":
> "É pré-requisito dos hooks (ADR-06) e das telas (ADR-07/08)."

**Resultado:** ambiguidade → ninguém implementou. A ADR-05 não é dona clara dos hooks; ADR-06 deveria sê-la, mas a ADR-05 os lista como seus arquivos.

**Ação corretiva:** 
1. **Reformular a descrição de escopo de ADR-05:** remover hooks da lista de "Arquivos afetados" e clarificar que ADR-05 é **apenas** tipos/enums/rótulos/validações. Hooks são ADR-06.
2. **Implementar os hooks em ADR-06** com TanStack Query, validação zod e alinhamento ao contrato da Edge Function.
3. **Reapprovar ADR-05 como standalone** depois que hooks forem criados (porque nenhum teste E2E rodou sem hooks).

---

## Fora de Escopo (Confirmado)

As seguintes telas/componentes **não foram criadas, mas são ADR-07 e ADR-08, não parte de ADR-05:**

- `src/app/config/whatsapp/WhatsAppPage.tsx`
- `src/app/config/whatsapp/ConnectionCard.tsx`
- `src/app/config/whatsapp/QrCodeDisplay.tsx`
- `src/app/config/whatsapp/RecentMessagesList.tsx`
- `src/app/whatsapp/SendMessageDialog.tsx`
- Alteração de `ConfigHubPage.tsx` para adicionar o card "WhatsApp"
- Alterações em `AgendaPage.tsx` e `ClientesPage.tsx` para botão "Enviar mensagem"

Isso é **esperado e confirmado** estar fora de ADR-05 (que é "fundação", não telas).

---

## Verificação Backend (Edge Function + Migrations)

**Não é responsabilidade formal de ADR-05**, mas relevante contexto:

- ✅ **Migrations:** 3 novas em ordem (`appointments_tenant_unique` pré-requisito, `whatsapp_instances`, `messages`), com RLS/RBAC/FKs compostas/dedupe_key. Testadas no banco local?
- ✅ **Edge Function:** implementada com zod, RBAC, opt-in LGPD, idempotência, adapter mock, tratamento defensivo. Código revisado em ADR-04.
- ✅ **Schemas Deno:** contrato de fio alinhado aos DTOs do frontend em `whatsapp.ts`.

Confirmação: o backend entrega o contrato que ADR-05 espera consumir.

---

## Resultado

**NEEDS_CHANGES** — motivo: **escopo ambíguo entre ADR-05 e ADR-06 sobre donos dos hooks causou que os hooks não fossem criados**. O código que SIM foi criado — tipos, enums, badge, capacidades, mapa de erro — foi feito com rigor e passa verificação. Mas ADR-05 como descrita não está completa.

**Ações antes de aprovação:**

1. **Clarificação formal:** ADR-05 é **apenas** tipos/enums/rótulos/validações/badge. Hooks (`useWhatsAppInstance`, `useMessages`) pertencem **a ADR-06 (é responsabilidade dela implementar)**.

2. **Reformulação da descrição de ADR-05:** remover hooks da tabela "Arquivos afetados"; reescrever "Consequências" para ficar claro que ADR-05 é pré-requisito dos hooks, não os contém.

3. **Validação de tokens de status:** confirmar que `status-confirmado`, `status-pendente`, `status-cancelado` existem e têm contraste ≥ 4.5:1 (CA-F07).

4. **Aprovação de ADR-05 como standalone tipos/utils** é viável agora (build/typecheck passam), **mas a cobertura E2E (CA-F01 a CA-F12)** fica pendente até ADR-06 + ADR-07/08 criarem as telas — não é defeito, só que ADR-05 é código de infra sem comportamento visual a verificar aqui.

</details>

---

## Recomendação

**Aprovação condicional (pós-clarificação de escopo):** ADR-05 code está saudável; a falha é comunicação/breakdown em nível de planejamento. Reformular a descrição de escopo, e a ADR passa.

