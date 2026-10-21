# Code Review — ADR-05: Infra de frontend (Textarea, schema zod, hook, RBAC)

**Revisor:** Reviewer A (independente)  
**Status:** ✅ APPROVED

---

## Summary

ADR-05 entrega cinco peças de infraestrutura frontend isoladas e reutilizáveis para a tela de templates de mensagem (ADR-06) e seu preview no SendMessageDialog (ADR-07): o primitivo `Textarea` (shadcn/ui padrão), tipo de domínio `MessageTemplateRow`, schema zod `messageTemplateSchema` para validação de form, hooks TanStack Query (`useMessageTemplates` / `useUpsertMessageTemplate`) com validação de payload externo, chave de cache `MESSAGE_TEMPLATES_KEY`, e permissão RBAC `canManageMessageTemplates`. A implementação espelha padrões já estabelecidos no projeto (`input.tsx`, `useServices`, `sendMessageSchema`), valida toda leitura do banco com zod, não envia `tenant_id` na escrita (deixa o RLS derivar do JWT), e passa por build/typecheck/tests sem erro. Nenhuma regressão em código existente.

**Watch for:** Nenhuma bloqueante. RLS é delegada à ADR-01 (migrations), que já foi approved; a validação de entrada (zod) está completa; o RBAC é defesa em profundidade espelhando `canManageWhatsAppConnection`.

---

## High-level view

O Textarea é um primitivo shadcn/ui idêntico ao padrão da biblioteca — sem customização fora dos tokens do projeto. O tipo `MessageTemplateRow` e o schema `messageTemplateSchema` encapsulam o contrato: forma de linha no banco, forma de entrada no form, enum fechado de chaves e limites (1–1000 chars body). 

Os hooks de dados (`useMessageTemplates` / `useUpsertMessageTemplate`) implementam o padrão TanStack Query + zod-validation-on-read já estabelecido no projeto: nada de `fetch` direto em `useEffect`, toda resposta de banco é validada antes de entrar no estado da aplicação, e o upsert não envia `tenant_id` — confia no default da coluna (RLS do JWT) e no `onConflict` configurado. Invalidação de cache é centralizada na chave `MESSAGE_TEMPLATES_KEY`.

RBAC é consistente com `canManageWhatsAppConnection`: `isAdmin` → `true`, resto → `false`. Defesa em profundidade — a trava real é o RLS no banco, mas a UI esconde os botões.

---

## Issues

Nenhuma. Todos os critérios de aceite da ADR-05 foram atendidos e as verificações de build/typecheck/test passaram.

---

<details>
<summary>Details</summary>

### Typecheck, build e testes

- `npm run typecheck`: passou, sem `any` implícito.
- `npm run build`: sucesso, Vite build completo (aviso de chunk size é pré-existente).
- `npm test -- --run`: todos os testes passaram (24 testes, incluindo message-templates.test.ts que já estava testando os schemas).
- Nenhuma regressão em ficheiros existentes.

### Primitivo Textarea

`src/components/ui/textarea.tsx` é exatamente o padrão shadcn/ui: `React.forwardRef` com `HTMLTextAreaElement`, merged classes Tailwind (min-h-[80px], focus-visible:ring-2, disabled:opacity-50) compatíveis com `input.tsx`. Sem customização desnecessária. Nenhum estilo extra.

### Tipo de domínio e validação

- `MessageTemplateRow` em `src/types/domain.ts`: colunas corretas (id, tenant_id, template_key, body, active, updated_at, created_at), tipadas sem `any`.
- `messageTemplateSchema` em `src/lib/validations/whatsapp.ts`: `templateKey` no enum `MESSAGE_TEMPLATES` (fechado), `body` trimado com limites 1–1000 chars, `active` boolean. Mensagens de erro em pt-BR.
- Schema zod é congruente com a restrição de banco (body 1–2000 chars), UI limita em 1000.

### Hook TanStack Query

`src/hooks/useMessageTemplates.ts`:
- `useMessageTemplates()`: `useQuery` com `MESSAGE_TEMPLATES_KEY`, faz `.select(...)` do banco, **valida a resposta com `messageTemplateListSchema.parse(data)` antes de retornar** — dado externo não confiável é regra. Sem `fetch` direto em `useEffect`.
- `useUpsertMessageTemplate()`: `useMutation` que **não envia `tenant_id` no payload** — apenas `templateKey`, `body`, `active`. `onConflict: 'tenant_id,template_key'` usa a unique constraint da ADR-01. Resposta é validada com `messageTemplateRowSchema.parse(data)`. `onSuccess` invalida o cache.
- SELECT_COLUMNS explícito, sem `select('*')`.

Padrão é consistente com `useServices`, confirmando reutilização correta.

### Chave de cache centralizada

`MESSAGE_TEMPLATES_KEY` em `src/lib/whatsapp.ts`: `["message-templates"]`, exportada, usada em hook e será consumida pelas telas (ADR-06/07). Centralização evita duplicação de chave e desincronização de invalidação.

### RBAC

`src/hooks/usePermissions.ts`: nova permissão `canManageMessageTemplates: boolean` adicionada à interface `Permissions` e ao retorno da função, com documentação ("Ler/editar os templates de mensagem do tenant (admin). Conteúdo editorial do dono."), atribuída como `= isAdmin`. Segue o padrão exato de `canManageWhatsAppConnection`.

### Conformidade com regras de projeto

- **TypeScript estrito:** sem `any` implícito, tipos exportados.
- **TanStack Query sem fetch direto:** apenas `useQuery` e `useMutation`.
- **Validação zod:** toda resposta de banco é parseada; schemas de form estão tipados.
- **pt-BR:** mensagens de erro em português.
- **Acessibilidade:** Textarea é padrão shadcn (markup semântico, atributos herdados).
- **Sem secrets:** nenhuma chave, token ou dado sensível no código.
- **Isolamento multi-tenant:** delegado à RLS (ADR-01 já approved); o hook nunca envia `tenant_id`.

### Sem regressão

Nenhum arquivo existente foi removido ou renomeado; `usePermissions` apenas expandiu a interface, e `validations/whatsapp.ts` apenas adicionou novo schema (a seção `sendMessageSchema` permanece intacta). Build completo confirma que nenhuma import foi quebrada.

</details>

---

## File map

<details>
<summary>Arquivos modificados</summary>

- `src/components/ui/textarea.tsx` — novo primitivo shadcn/ui padrão.
- `src/types/domain.ts` — adicionado tipo `MessageTemplateRow`.
- `src/lib/validations/whatsapp.ts` — adicionado `messageTemplateSchema` + `MessageTemplateInput`.
- `src/hooks/useMessageTemplates.ts` — novo hook de dados (query + mutation).
- `src/lib/whatsapp.ts` — adicionado `MESSAGE_TEMPLATES_KEY`.
- `src/hooks/usePermissions.ts` — adicionado `canManageMessageTemplates`.

Nenhuma mudança em banco de dados nesta ADR (migrations são ADR-01/ADR-02, já approved).

</details>

---

**Verdict: APPROVED** — Infraestrutura pronta, sem bloqueantes. ADR-06 pode usar estes componentes com confiança.
