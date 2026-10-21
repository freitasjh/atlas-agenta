# ADR-05 — Infra de frontend: `Textarea`, schema zod, hook de dados e RBAC

**Status:** proposto

**Escopo:** frontend

**Depende de:** ADR-03 (o schema e o hook referenciam a lista fechada/contrato); ADR-01 (o hook lê
`message_templates` sob RLS — a tabela precisa existir). Entrega as peças de base que a tela (ADR-06)
e o preview de envio (ADR-07) consomem, sem ainda montar nenhuma tela.

## Contexto

A tela de templates (ADR-06) precisa de quatro peças de base que hoje não existem e que são, cada
uma, pequenas e isoladas: (1) o primitivo `Textarea` (o projeto só tem `input.tsx`); (2) o schema
zod do formulário; (3) o hook TanStack Query de leitura/escrita; (4) a capacidade de RBAC
`canManageMessageTemplates`. Agrupá-las numa ADR evita quatro ADRs triviais e deixa o build verde
com as fundações prontas. Os padrões a seguir são os já estabelecidos: `input.tsx` (primitivo
shadcn), `src/lib/validations/whatsapp.ts` (`sendMessageSchema`), `useServices.ts` (hook com zod +
`invalidateQueries`), `usePermissions.ts` (`canManageWhatsAppConnection: isAdmin`).

A escrita de template é **do cliente sob RLS** (como `services`), não via Edge Function: templates
são conteúdo editorial, não operação privilegiada; a RLS (ADR-01) garante isolamento e o RBAC
(escrita só admin).

## Decisão

1. **Primitivo `src/components/ui/textarea.tsx`** (novo): componente shadcn/ui padrão
   (`React.forwardRef<HTMLTextAreaElement, React.ComponentProps<'textarea'>>`), mesmas classes de
   estilo do `input.tsx` adaptadas para multilinha (`min-h-[...]`, `focus-visible:ring-2
   ring-ring`), sem customização além dos tokens já existentes. Peça canônica, não primitivo caseiro
   (decisão D7).
2. **Tipo de domínio** em `src/types/domain.ts`: adicionar `interface MessageTemplateRow { id:
   string; tenant_id: string; template_key: MessageTemplate; body: string; active: boolean;
   updated_at: string; created_at: string }` (reusa o enum `MessageTemplate` existente).
3. **Schema zod** em `src/lib/validations/whatsapp.ts` (ao lado de `sendMessageSchema`):
   `messageTemplateSchema = z.object({ templateKey: z.enum(MESSAGE_TEMPLATES, {...pt-BR}), body:
   z.string().trim().min(1, "Escreva o texto do modelo.").max(1000, "O texto do modelo é muito
   longo."), active: z.boolean() })` e `type MessageTemplateInput`. (Banco aceita 2000; form limita
   1000 — ADR-01.)
4. **Hook `src/hooks/useMessageTemplates.ts`** (novo), espelhando `useServices.ts`:
   - `useMessageTemplates()` → `useQuery`, `supabase.from('message_templates').select('id,
     tenant_id, template_key, body, active, updated_at, created_at').order('template_key')`; valida
     o array com um `messageTemplateRowSchema` zod antes de usar (dado externo não confiável);
     `template_key` no enum `MESSAGE_TEMPLATES`. O cliente **nunca** envia `tenant_id` (RLS deriva do
     JWT).
   - `useUpsertMessageTemplate()` → `useMutation` com `upsert` por `(tenant_id, template_key)`
     usando `onConflict: 'tenant_id,template_key'` (o `tenant_id` vem do default da coluna / RLS, não
     do payload); em sucesso, `invalidateQueries({ queryKey: MESSAGE_TEMPLATES_KEY })`.
   - Chave de query dedicada `MESSAGE_TEMPLATES_KEY = ["message-templates"] as const` exportada em
     `src/lib/whatsapp.ts` (onde já moram `MESSAGES_KEY`/`WHATSAPP_INSTANCE_KEY`).
5. **RBAC** em `src/hooks/usePermissions.ts`: adicionar `canManageMessageTemplates: boolean` à
   interface `Permissions` e ao retorno (`= isAdmin`), com doc espelhando
   `canManageWhatsAppConnection`.

## Consequências

- As telas da ADR-06/07 consomem hook, schema, primitivo e flag já prontos e tipados.
- A escrita do cliente sob RLS é coerente com `services`/`professionals`; nenhum caminho novo de
  service role no cliente.
- `MESSAGE_TEMPLATES_KEY` centraliza a invalidação de cache do módulo.

## Arquivos afetados

- `src/components/ui/textarea.tsx` (novo)
- `src/types/domain.ts` (adicionar `MessageTemplateRow`)
- `src/lib/validations/whatsapp.ts` (adicionar `messageTemplateSchema` + tipo)
- `src/hooks/useMessageTemplates.ts` (novo)
- `src/lib/whatsapp.ts` (adicionar `MESSAGE_TEMPLATES_KEY`)
- `src/hooks/usePermissions.ts` (adicionar `canManageMessageTemplates`)

## Critérios de aceite (testáveis nesta ADR)

- **Typecheck/build:** `npm run build` (tsc -b + vite build) limpo, sem `any` implícito; os novos
  símbolos (`Textarea`, `messageTemplateSchema`, `useMessageTemplates`, `useUpsertMessageTemplate`,
  `MESSAGE_TEMPLATES_KEY`, `canManageMessageTemplates`, `MessageTemplateRow`) exportados e tipados.
- **RNF-T03:** o shape lido do banco é validado por zod antes do uso; `body` do form validado
  (1–1000); `templateKey` no enum fechado.
- **Sem regressão:** o restante de `usePermissions`/`validations/whatsapp.ts`/`whatsapp.ts` continua
  intacto (nada removido/renomeado). Verificar: `npm run build` exit 0.
- A prova funcional ponta a ponta (ler/editar sob RLS, isolamento entre tenants) ocorre quando a tela
  da ADR-06 existe; aqui a verificação é typecheck/build + revisão do contrato.
