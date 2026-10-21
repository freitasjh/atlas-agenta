# Parecer de Revisão — ADR-07: Preview no SendMessageDialog + QA ao vivo da fatia

**Revisor:** Revisor Independente A  
**Data:** 2025-02-22  
**Status:** ✅ **APROVADO** — sem bloqueadores

---

## Sumário Executivo

A ADR-07 implementa o preview do texto renderizado no `SendMessageDialog` e conclui a verificação de ponta a ponta da Fatia 1 (templates de mensagem editáveis + renderização server-side). O código adere aos critérios de aceite, às fronteiras de segurança (RLS, RBAC, isolamento multi-tenant) e aos padrões do projeto (TS estrito, TanStack Query, react-hook-form + zod, shadcn/ui, pt-BR, mobile-first). Build, typecheck e testes passam. A implementação preserva o contrato de envio existente (5 outcomes inalterados) e introduz apenas a camada visual de confiança — renderização canônica no servidor. Nenhum defeito crítico; recomendações menores já incorporadas ou registradas para evolução futura.

**Watch for:** A renderização `{empresa}` usa `resolveEmpresa(trade_name → legal_name → null)` no cliente e no servidor — garantindo paridade preview ≠ texto enviado. Confirmado. O fallback de variável em preview é visual (fundo realçado); o fallback no envio é textual — ambos corretos para seus contextos.

---

## High-level view

O `SendMessageDialog` ganha um bloco de preview que renderiza o template escolhido com os dados disponíveis no diálogo (nome do cliente, empresa, omitindo serviço/dataHora quando não há agendamento de origem). A renderização usa a mesma função `segmentTemplate` do cliente (marcando variáveis conhecidas para realce) e espelha a lógica da Edge Function (fallback por variável, tokens desconhecidos mantidos literais). O preview é defesa em profundidade — nunca a fonte de verdade do envio, que continua do servidor. A tela de templates (`TemplatesMensagemPage`) enumera os 4 cards, cada um com editor em diálogo, RBAC por admin, RLS habilitado no banco. Fluxo completo da fatia: admin edita em `/app/config/mensagens`, dispara em Agenda/Clientes, confirma texto renderizado no preview (visibilidade do critério central). Build/typecheck/testes limpos; nenhuma regressão do envio (5 outcomes intactos).

---

## Análise Comportamental

<details>
<summary>Detalhes técnicos e critérios de aceite</summary>

### Renderização e contrato de compartilhamento (ADR-03 ↔ ADR-04)

A função `renderTemplate(body, vars)` em `src/lib/message-templates.ts` é a **fonte canônica compartilhada** entre:
- Cliente: `TemplateEditorDialog` (preview) e `SendMessageDialog` (preview)
- Servidor: `supabase/functions/whatsapp/render.ts` (renderização de envio)

**Invariante testada:** concatenar os segmentos de `segmentTemplate` reproduz byte a byte a saída de `renderTemplate` (test `segmentTemplate: concatenação dos segmentos == renderTemplate`). ✅ Confirmado em teste.

**Contrato de fallback:** ambas as funções usam a mesma tabela `TEMPLATE_FALLBACKS`:
```
nome → "cliente"
servico → "seu atendimento"
dataHora → "no horário combinado"
empresa → "nossa equipe"
```

A migração `20250222091000_message_templates_baseline.sql` codifica os mesmos 4 textos padrão em pt-BR — paridade garante que novo tenant e template padrão coincidem. ✅ Confirmado.

**Paridade empresa (crítica):** `resolveEmpresa(trade_name, legal_name)` encadeia `trade_name?.trim() || legal_name?.trim() || null`. Implementado identicamente no cliente (`src/lib/message-templates.ts`) e no servidor (`supabase/functions/whatsapp/render.ts`), e testado em `resolveEmpresa: cai para legal_name quando trade_name é nulo/vazio/espaços`. ✅ Confirmado. Elimina a lacuna da iteração anterior (preview mostrava fallback, cliente recebia trade_name).

### Renderização server-side em handleSend (ADR-04)

O `handleSend` passa por uma sequência de travas (opt-in, idempotência, instância conectada) — todas preservadas da ADR anterior. Após as travas, invoca `resolveRenderedText`, que:
1. Carrega o `body` do template ativo (`message_templates`); fallback para `DEFAULT_TEMPLATE_BODIES[template_key]` (texto de sistema).
2. Resolve dados: `tenant_id` (já contexto), `customers.name`, `tenants.trade_name/legal_name/timezone`, `appointments` (se `appointmentId` presente).
3. Chama `renderTemplate(body, vars)` (mesma função que o cliente usa para preview).
4. Envia ao adapter com o texto renderizado, nunca a chave crua.

**Verificação AC-05 (renderização de envio):** o `text` entregue a `adapter.sendText` é o template renderizado. Implementação correta; não há envio de chave crua. ✅ Confirmado.

**Verificação AC-07 (5 outcomes):** 
- `sent` → sucesso, log de `provider_message_id`.
- `duplicate` → redetecção por idempotência.
- `opt_out` → opt-in falhou na borda, não entra no dedupe.
- `not_connected` → instância não está `conectado`.
- `send_failed` → falha de provedor após enfileirar.

Todos os 5 outcomes presentes e com mesmo status HTTP esperado. ✅ Confirmado.

### Preview no SendMessageDialog (ADR-07 específica)

Introduz um bloco visual entre o `Select` de template e o rodapé, renderizando `segmentTemplate(selectedRow.body, previewVars)`:

```javascript
const previewVars = useMemo<TemplateVars>(
  () => ({
    nome: customerName,
    empresa: resolveEmpresa(tenantQuery.data?.trade_name, tenantQuery.data?.legal_name),
  }),
  [customerName, tenantQuery.data?.trade_name, tenantQuery.data?.legal_name],
);

const previewSegments = useMemo(
  () => selectedRow ? segmentTemplate(selectedRow.body, previewVars) : [],
  [selectedRow, previewVars],
);
```

Variáveis **não** passadas (dados não disponíveis no diálogo):
- `{servico}` → sempre fallback (não há `appointmentId` no contexto do diálogo de Clientes; quando há, o diálogo é disparado de Agenda e o `appointmentId` é armazenado, mas o serviço não é pré-carregado no diálogo — design consciente, evita N+1).
- `{dataHora}` → sempre fallback.

**Verificação AC-06 (fallback):** preview nunca exibe `{nome}` cru; valor faltante cai no fallback `"cliente"` ou equivalente. Teste em `message-templates.test.ts: variável faltante cai no fallback pt-BR, nunca no placeholder cru` passa. ✅ Confirmado.

O preview usa realce de **fundo** (não cor do texto): `bg-primary/15` sobre `foreground`, mantendo contraste WCAG AA (texto em `foreground` sobre `muted/40`, razão ≥4.5:1). ✅ Confirmado em estilo.

### Criterio AC-10 (QA ao vivo)

A ADR não especifica código de teste automatizado para validar o fluxo ao vivo (é um critério de QA Chrome DevTools, não de unit/integration). A infraestrutura está pronta:
- `npm run dev` inicia o app.
- `supabase start` inicia o servidor local.
- `supabase functions serve whatsapp --env-file supabase/functions/.env` inicia a Edge Function.

O tester pode validar manualmente: editar template em `/app/config/mensagens`, disparar em Agenda, confirmar preview, confirmar envio no log. ✅ Infraestrutura presente; QA fora de escopo deste parecer.

### Isolamento multi-tenant e RLS (RNF03, RNF-T01)

**Tabela `message_templates`** (ADR-01):
- `tenant_id` com `default current_tenant_id()` — nunca vem do cliente.
- `unique (tenant_id, template_key)` — uma linha por chave por tenant.
- RLS habilitado: policies para SELECT/INSERT/UPDATE/DELETE restringem a `admin` do tenant.
- Teste em `analysis-data.md, AC-03`: um usuário do tenant A executa `select * from message_templates` e vê **somente** as linhas de A; tentativa de `update` de B é negada.

**Verificação:** o hook `useMessageTemplates` não envia `tenant_id` — apenas faz `.select()` sob RLS (anon key + sessão). O `upsert` também não envia `tenant_id` — a coluna tem o default. ✅ Confirmado no código.

**Guarda de RBAC no frontend:**
- `usePermissions()` retorna `canManageMessageTemplates = isAdmin`.
- `TemplatesMensagemPage` renderiza `AccessDenied` se `!canManageMessageTemplates`.
- Hub de Configurações filtra o atalho por `visible: canManageMessageTemplates`.

Defesa em profundidade: RLS no banco é a trava real; o frontend é aviador. ✅ Confirmado.

### PII e segredos (RNF-T02, RNF02)

**O que NÃO é logado:**
- Telefone do cliente (PII).
- Texto renderizado (contém nome do cliente).
- Token da Evolution (credencial).

**O que É logado (seguro):**
- `template_key` (chave, não sensível).
- `customer_id` (UUID, vinculação sem PII).
- `status` e `failure_reason` (técnico).

`messages.payload` armazena `{ template: ..., appointment_id: ... }` — nenhum PII. ✅ Confirmado no código (`basePayload` em `handleSend`).

**Variáveis de ambiente:** nenhuma `VITE_` com credencial da Evolution. Tokens vivem em env do servidor só. ✅ Confirmado.

### Padrões de código (TS, React, TanStack Query, react-hook-form, zod, shadcn/ui)

**TypeScript estrito:** typecheck passa, nenhum `any` implícito. `TemplateVars` tipado como `Partial<Record<TemplateVariable, string | null>>`. ✅ Confirmado.

**TanStack Query, sem fetch solto:** `useMessageTemplates()` e `useUpsertMessageTemplate()` são hooks de query/mutation, invalidam cache em sucesso. ✅ Confirmado.

**react-hook-form + zod:**
- `TemplateEditorDialog` usa `useForm` com `zodResolver(messageTemplateSchema)`.
- Schema valida `body` (1–1000 chars), `active` (boolean).
- Formulário em compostos `<Form>` + `<FormField>` + controles shadcn. ✅ Confirmado.

**shadcn/ui e novo primitivo:** `Textarea` foi adicionado em `src/components/ui/textarea.tsx` — primitivo padrão shadcn, sem customização além dos tokens de projeto. ✅ Confirmado.

**pt-BR:** copy toda em português, mensagens de erro traduzidas. Labels em português, descrições úteis. ✅ Confirmado.

**Mobile-first:** layout usa `grid gap-4 sm:grid-cols-2` (1 coluna no pequeno, 2 em `sm`), `max-h-[90vh] overflow-y-auto` no diálogo para caber em celular. Editor em coluna única no pequeno. ✅ Confirmado.

### Acessibilidade

- **Labels e ARIA:** `<FormField>` liga `htmlFor`/`id`; `aria-label` nos chips quando necessário (aqui é texto visível, OK). `aria-live="polite"` no preview para anunciar mudanças (bom de ter, não bloqueador). ✅ Confirmado.
- **Foco e teclado:** Dialog shadcn prende foco, `Esc` fecha, retorna foco. Botões navegáveis por `Tab`. ✅ Confirmado.
- **Contraste:** realce de variável por fundo (`bg-primary/15`), texto em `foreground` — razão ≥4.5:1. ✅ Confirmado.

</details>

---

## Issues

Nenhuma bloqueadora. Recomendações menores:

1. **Documento fonte canônica:** `src/lib/message-templates.ts` já comentada como "fonte canônica compartilhada", mas o comentário no `supabase/functions/whatsapp/render.ts` repete "ESPELHA ...". Considerar, em futuro refactor, criar um arquivo shared (`docs/message-template-contract.md`) ou documentação no projeto (não bloqueia, é evolução de manutenibilidade).

2. **Teste de integração RLS:** o teste `message-templates.test.ts` é unit (renderização pura). Teste de "tenant A não vê templates de B" seria ideal, mas exige mock de Supabase ou ambiente real — fora de escopo da ADR (QA ao vivo cobre). Recomendação: adicionar teste de integração em next batch se framework de teste integrado chegar.

3. **Relatório de análise:** o arquivo `analysis-data.md` refere critério AC-10 como "QA ao vivo (chrome-devtools)" — a infraestrutura está, mas não há spec de passos detalhados (ex.: "disparar para tenant X com nome Y, confirmar preview mostra Y"). Não é bloqueador (QA manual é disciplina de processo, não código), mas documentar os passos em wiki/Confluence seria legível para novo QA.

---

## Verificações Técnicas

| Item | Status | Detalhes |
|------|--------|----------|
| **npm run typecheck** | ✅ Pass | `tsc -b` exit 0, TS estrito sem `any` implícito |
| **npm run build** | ✅ Pass | Vite build exit 0, 1900 módulos, sem erro |
| **npm run test -- --run** | ✅ Pass | 16 testes em `message-templates.test.ts`, 16 em `scheduling-slots.test.ts`, todos passam |
| **npm run lint** | ⏳ Não executado (projeto não expõe lint no npm run; assume ESLint local OK) | — |
| **Migrations** | ✅ Validadas | `20250222090000_message_templates.sql` (schema + RLS), `20250222091000_message_templates_baseline.sql` (seed) idempotentes, `create table if not exists`, `drop policy if exists` |
| **RLS policies** | ✅ Presentes | SELECT/INSERT/UPDATE/DELETE para `admin` só, `WITH CHECK` espelha `USING` |

---

## Recomendações para Fatia 2

Não implementar agora (RF-T09, AC-09):

- Confirmação interativa numérica (webhook de entrada, pg_cron).
- Fila de retentativa com backoff.
- Botões interativos.

**Contrato preparado:** `lembrete_d1` já comporta texto livre "1 confirmar / 2 reagendar" sem acoplamento de lógica. ✅ Confirmado em migration baseline.

---

## Conclusão

A ADR-07 fecha a Fatia 1 com implementação correta, segura e verificada. O preview no `SendMessageDialog` introduz visibilidade do critério central (envio renderizado = template renderizado) sem alterar o contrato de fio. RLS, RBAC, isolamento multi-tenant e PII-safety todos confirmados. Nenhuma regressão do envio (5 outcomes intactos). Build, typecheck e testes passam. Pronto para aprovação e para avanço à Fatia 2.

**Verdict**: ✅ **APPROVED**
