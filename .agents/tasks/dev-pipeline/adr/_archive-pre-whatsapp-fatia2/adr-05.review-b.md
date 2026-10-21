# Revisão B — ADR-05: Infra de frontend (Textarea, schema zod, hook, RBAC)

Infra de base da Fatia 1 do WhatsApp Fase 2: o primitivo `Textarea`, o tipo de domínio
`MessageTemplateRow`, o `messageTemplateSchema` (zod), o hook `useMessageTemplates`
(leitura + upsert) e a capacidade de RBAC `canManageMessageTemplates`. Seis arquivos,
+139 linhas, nenhuma tela — só as peças que ADR-06/07 consomem. O diff replica fielmente
os padrões já estabelecidos (`input.tsx`, `useServices.ts`, `usePermissions.ts`,
`validations/whatsapp.ts`) e mantém a escrita de template no cliente sob RLS, sem nenhum
caminho novo de service role no navegador.

Watch for: a validação de `body` do formulário (1–1000) não é espelhada pela leitura do
hook — `messageTemplateRowSchema` não valida `char_length`, confiando na constraint do
banco (confirmed, não-bloqueante); o schema de leitura também não trava `active`/datas além
do tipo (confirmed, cosmético).

**Verdict**: APPROVED

## High-level view

O escopo é puramente aditivo e tipado. `npm run build` (tsc -b + vite build) sai 0 e as 24
unidades do projeto (incluindo as 8 de `message-templates.test.ts` da ADR-03) passam; a
ADR-05 corretamente não traz testes próprios — seu critério de aceite é typecheck/build +
contrato, e a prova funcional ponta a ponta fica para ADR-06/07.

O isolamento multi-tenant está correto por omissão deliberada: nenhuma das duas operações
do hook envia `tenant_id`. O `select` deriva o tenant do JWT via RLS; o `upsert` conta com o
`default current_tenant_id()` da coluna (ADR-01) e usa `onConflict: 'tenant_id,template_key'`.
Esse é exatamente o padrão que o brain registra como regra do projeto
(`multitenant-default-tenant-id-with-check`), aprendido num bug de causa-raiz anterior — aqui
ele foi seguido, não reinventado. A escrita de conteúdo editorial pelo cliente sob RLS é
coerente com `services`/`professionals`.

O RBAC é defesa em profundidade: `canManageMessageTemplates = isAdmin` espelha
`canManageWhatsAppConnection` e casa com a policy da ADR-01 (leitura/escrita só `admin`). A
trava real continua no banco; a flag só esconde UI.

A única observação de substância é uma assimetria de validação: o form limita `body` a 1000,
mas o `messageTemplateRowSchema` (que valida o retorno do banco) aceita `z.string()` sem teto.
É consistente com o padrão do projeto (`serviceRowSchema` também não replica regras de range na
leitura) e o banco é o teto real (2000), então não é bloqueante — vale registrar como caveat.

## Aderência à ADR

Cada item da seção "Decisão" tem correspondência 1:1 no diff:

- `src/components/ui/textarea.tsx` — `forwardRef<HTMLTextAreaElement, ComponentProps<'textarea'>>`,
  `min-h-[80px]`, `focus-visible:ring-2 ring-ring`, classes idênticas ao `input.tsx` adaptadas
  para multilinha. Peça canônica shadcn, sem customização além dos tokens. ✓
- `MessageTemplateRow` em `domain.ts` reusa o enum `MessageTemplate`, campos batem com a
  tabela da ADR-01. ✓
- `messageTemplateSchema` ao lado de `sendMessageSchema`: `templateKey` no enum fechado,
  `body` `.trim().min(1).max(1000)` com mensagens pt-BR, `active: z.boolean()`. ✓
- `useMessageTemplates` espelha `useServices`: `select` das 7 colunas, `.order('template_key')`,
  valida o array com zod antes de usar. `useUpsertMessageTemplate` com `onConflict` e
  `invalidateQueries(MESSAGE_TEMPLATES_KEY)`. ✓
- `MESSAGE_TEMPLATES_KEY = ['message-templates']` em `lib/whatsapp.ts`, ao lado de
  `MESSAGES_KEY`/`WHATSAPP_INSTANCE_KEY`. ✓
- `canManageMessageTemplates: isAdmin` na interface `Permissions` e no retorno. ✓

Nenhum símbolo foi removido ou renomeado; o resto de `usePermissions`/`validations/whatsapp.ts`/
`whatsapp.ts`/`domain.ts` está intacto.

<details>
<summary>Issues (2)</summary>

1. **Assimetria de validação body (confirmed, não-bloqueante)** — o form trava `body` em 1–1000,
   mas `messageTemplateRowSchema` (retorno do banco) aceita `z.string()` sem range. Consistente
   com `serviceRowSchema` e o banco é o teto real (2000). Opcional: documentar que a leitura
   confia no `check` do banco, ou alinhar um `.max(2000)` para falhar cedo se a constraint um dia
   mudar.
2. **Schema de leitura tipa mas não valida semântica (confirmed, cosmético)** — `updated_at`/
   `created_at` são `z.string()` sem `.datetime()`; `active` só checa o tipo. Sem impacto de
   segurança (o shape vem do próprio banco sob RLS), apenas defesa mais frouxa do que poderia.
   Mesmo padrão dos hooks existentes; registrar como caveat, não ação obrigatória.

</details>

<details>
<summary>Details</summary>

### Isolamento multi-tenant no upsert — correto e alinhado ao brain

O ponto mais sensível da ADR é a escrita. O `upsert` monta o payload só com
`template_key`, `body`, `active` — sem `tenant_id`. Rastreando contra a migration da ADR-01
(`20250222090000_message_templates.sql`):

- `tenant_id uuid not null default current_tenant_id()` preenche a coluna no INSERT;
- a policy `message_templates_write_admin` é `for all` com `using` e `with check` ambos
  `tenant_id = current_tenant_id() and current_role_name() = 'admin'`;
- `onConflict: 'tenant_id,template_key'` casa com a unique `message_templates_tenant_key_unique`.

No caminho INSERT, o default resolve o `tenant_id` antes da checagem de conflito, então o
`WITH CHECK` passa. No caminho UPDATE (conflito), o PostgREST aplica só as colunas do payload
sobre a linha existente; `tenant_id` fica inalterado (já igual a `current_tenant_id()`, pois a
linha nasceu assim), e tanto `USING` quanto `WITH CHECK` passam. Não há como mover linha entre
tenants por este caminho. Isso é exatamente a regra registrada no brain
(`multitenant-default-tenant-id-with-check`, `tenant-id-default-current-tenant-id-para-escrita-rls`),
aprendida de um bug de causa-raiz anterior onde a falta do default reprovava a escrita do
cliente. Aqui o padrão foi respeitado.

Nenhum segredo entra no bundle: o hook usa `supabase` (anon key + sessão), sem service role.
`body` é texto com placeholders, não PII nem segredo — coerente com o doc da ADR e com
seguranca-multitenant.md.

### Validação de dados externos (RNF-T03)

A leitura valida o retorno com `messageTemplateListSchema.parse(data)` e o upsert com
`messageTemplateRowSchema.parse(data)` antes de devolver — dado do banco tratado como externo,
como manda a convenção. `template_key` é travado no enum `MESSAGE_TEMPLATES`. A assimetria
descrita no issue 1 (sem `.max` no `body` da leitura) é a única folga, e é a mesma que
`serviceRowSchema` já tem; não é regressão introduzida por esta ADR.

### RBAC — defesa em profundidade coerente

`canManageMessageTemplates = isAdmin` na UI casa com a RLS da ADR-01 (SELECT e ALL só para
`admin`). Importante: a leitura de template é admin-only, mas o envio de mensagem
(`canSendWhatsAppMessage` = admin/receptionist/professional) **não** depende de ler esta tabela —
a renderização é server-side na Edge Function (ADR-04, service role). Logo, restringir a leitura
ao admin reduz superfície sem quebrar o disparo da recepção/profissional. A camada de app é só
esconder UI; a trava real é o banco.

### Contraprova executada

`npm run build` → exit 0 (tsc -b + vite build, 1892 módulos, sem erro de tipo; o aviso de chunk
>500kB é pré-existente e fora do escopo). `npm run test` → 24/24 (8 de `message-templates.test.ts`
+ 16 de `scheduling-slots.test.ts`), exit 0. Não há script de lint no `package.json`; os gates de
qualidade do projeto são `build` e `test`, ambos verdes. Não subi dev server (QA é o step
seguinte).

</details>

<details>
<summary>Mapa de arquivos</summary>

- `src/components/ui/textarea.tsx` (novo) — primitivo shadcn multilinha, clone estilístico de `input.tsx`.
- `src/types/domain.ts` — adiciona a interface `MessageTemplateRow` (reusa o enum `MessageTemplate`).
- `src/lib/validations/whatsapp.ts` — adiciona `messageTemplateSchema` + `MessageTemplateInput`.
- `src/hooks/useMessageTemplates.ts` (novo) — `useMessageTemplates` (query) + `useUpsertMessageTemplate` (mutation), zod na leitura/escrita.
- `src/lib/whatsapp.ts` — adiciona `MESSAGE_TEMPLATES_KEY`.
- `src/hooks/usePermissions.ts` — adiciona `canManageMessageTemplates: isAdmin`.

Diff completo: `git show 3b2ce4a`.

</details>
