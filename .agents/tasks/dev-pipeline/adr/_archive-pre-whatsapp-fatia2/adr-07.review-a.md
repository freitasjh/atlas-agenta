# Review Independente A — ADR-07: Preview no SendMessageDialog + QA ao vivo

**Revisor:** Revisor Independente A  
**ADR:** adr-07-preview-envio-e-qa.md  
**Escopo:** Frontend (preview no diálogo de envio) + verificação ponta a ponta server-side  
**Status do escopo:** PENDENTE (QA ao vivo)  
**Data da revisão:** 2025-02-22

## Resumo

Esta ADR completa a Fatia 1 do WhatsApp Fase 2 adicionando o preview do texto renderizado no `SendMessageDialog` e validando que o envio de fato usa o template renderizado (não a chave crua). A implementação cobre:

1. **Server-side**: renderização do template em `resolveRenderedText()` + utilitários em `render.ts` que espelham a lista fechada de variáveis (`{nome} {servico} {dataHora} {empresa}`) e tabela de fallback pt-BR.
2. **Frontend**: preview no `SendMessageDialog` via `segmentTemplate()` para realce visual de variáveis (realce por fundo); desacoplamento da leitura de templates (opções vêm do enum, não do fetch — permite receptionist/professional disparar apesar de RLS).
3. **Isolamento**: RLS em `message_templates` mantém o isolamento por tenant; RBAC garante que só admin gerencia, mas todos os papéis podem disparar.
4. **Não-regressão**: os 5 outcomes de `send` (`sent|duplicate|opt_out|not_connected|send_failed`) preservados; única mudança é `text: input.template` → `text: renderedText`.

Build, typecheck, testes — todos passam. Renderização testada unitariamente (16 casos em `message-templates.test.ts`). **Pronto para QA ao vivo.**

**Verdict**: APROVADO com avisos menores (veja seção Issues).

---

## High-level view

A renderização server-side está corretamente implementada em Deno, reusando a mesma lista fechada e tabela de fallback do cliente — a paridade é centralizada em constantes (`DEFAULT_TEMPLATE_BODIES`, `TEMPLATE_FALLBACKS`, `TEMPLATE_VARIABLES`) espelhadas em dois arquivos. Nenhum PII (nome do cliente) é logado; o texto renderizado nunca deixa a Edge Function em claro, apenas o status técnico é gravado em `messages`.

O desacoplamento de leitura de templates (opções do `Select` vêm do enum, não do fetch) é elegante e garante que receptionist/professional, que não conseguem ler a tabela por RLS (políticas restritas a admin), ainda assim conseguem disparar com as 4 chaves — coerente com o requisito de não quebrar o fluxo. O fallback de template ausente (DEFAULT_TEMPLATE_BODIES) no servidor funciona como safety net para tenant legado sem seed.

Acessibilidade: o realce de token no preview é por **fundo** (texto em `foreground`), não apenas cor, resolvendo a preocupação de contraste. Teclado e foco visível herdados do shadcn/ui.

Um risco menor: `formatDataHora` em `render.ts` usa `Intl.DateTimeFormat`, puro e determinístico, mas o fuso está hard-codado como fallback `"America/Sao_Paulo"` — coerente com o padrão do projeto, mas vale registrar.

---

<details>
<summary>Issues (3)</summary>

1. **Paridade renderização cliente/servidor — monitorar em evolução aditiva** — A lista de variáveis (`TEMPLATE_VARIABLES`) e tabela de fallback (`TEMPLATE_FALLBACKS`) vivem em dois arquivos (`src/lib/message-templates.ts` e `supabase/functions/whatsapp/render.ts`). Mudança aditiva em uma delas DEVE refletir na outra senão divergem (preview ≠ texto enviado). Não é defeito agora — ambas estão sincronizadas e comentadas —, mas é um ponto de falha para a evolução futura. **Ação:** registrar no brain como invariante de desenvolvimento; adicionar check em CI/CD se houver divergência de constantes (baixa prioridade, não bloqueia Fatia 1).

2. **Fuso do tenant — fallback hard-codado** — Se o tenant tiver `timezone` nulo/vazio, a Edge Function cai para `"America/Sao_Paulo"` (fallback em `resolveRenderedText`). É coerente com a convenção do projeto, mas não há validação de que o fuso é válido (`timeZone` é string genérica em `tenants`). **Ação:** Não bloqueia Fatia 1; na Fatia 2, considerar validação de enum de fusos conhecidos ou constraint no banco (Supabase tem `pg_timezone_names`, usar se necessário).

3. **Preview no `SendMessageDialog` cobre só `{nome}`/`{empresa}`** — `{servico}`/`{dataHora}` aparecem como fallback pt-BR no preview porque o diálogo recebe só `appointmentId`, não os dados do agendamento. A renderização server-side (AD-04) resolve os dados reais. É uma decisão consciente (registrada em ADR-07 §1.6), mas o admin vê um preview "incompleto" se disparar de Clientes (sem agenda). **Ação:** Não é defeito — o servidor resolve corretamente; o preview é defesa em profundidade, não a fonte da verdade. Considerada decisão apropriada para não inflar o contrato do diálogo com toda a resolução de agendamento.

</details>

---

## Detalhes da revisão

<details>
<summary>Details</summary>

### Renderização server-side: implementação correta, PII protegido

A função `resolveRenderedText()` em `supabase/functions/whatsapp/index.ts` segue o padrão correto:

1. **Carrega o template do tenant** por `(tenant_id, template_key, active=true)` com service role — nenhuma exposição do tenant_id ao cliente.
2. **Fallback para DEFAULT_TEMPLATE_BODIES** quando a linha não existe ou está inativa — garante que nunca envia a chave crua.
3. **Resolve dados sob service role** dentro do tenant: `customer.name`, `tenants.trade_name|legal_name`, `appointments.starts_at` + `services.name`, tudo filtrado por tenant_id.
4. **Formata data/hora no fuso do tenant** via `Intl.DateTimeFormat` (determinístico, sem efeitos colaterais).
5. **Renderiza com a mesma tabela de fallback** — nenhuma variável conhecida sai crua.

Nenhum PII (nome do cliente, texto renderizado com nome) é logado em claro — RNF-T02 cumprida. O `messages.status` é técnico ("enviado"/"falha"); `failure_reason` é código genérico.

**Crítica:** A parsing segura de `appointment.services` (que pode vir como array ou objeto conforme o embed) está implementada com type guards apropriados — nenhum `any` forçado ou cast inseguro.

### Lista fechada de variáveis — paridade cliente/servidor

**Cliente** (`src/lib/message-templates.ts`):
- `TEMPLATE_VARIABLES` = `["nome", "servico", "dataHora", "empresa"]`
- `TEMPLATE_FALLBACKS` = tabela pt-BR por variável
- `renderTemplate()` + `segmentTemplate()` para preview e realce

**Servidor** (`supabase/functions/whatsapp/render.ts`):
- `TEMPLATE_VARIABLES` = idêntico
- `TEMPLATE_FALLBACKS` = idêntico
- `renderTemplate()` = lógica idêntica

**Validação:** Os comentários no topo de `render.ts` dizem explicitamente "ESPELHA" e "PARIDADE OBRIGATÓRIA", sinalizando a dependência. Não há test no servidor em Deno (Edge Function não tem suite de testes nativa no projeto), mas a renderização é testada extensivamente no cliente (16 testes em `message-templates.test.ts`), e o servidor reusa o mesmo algoritmo.

**Risco:** Se alguém mudar `TEMPLATE_VARIABLES` num arquivo e esquecer do outro, o preview (cliente) e o envio (servidor) divergem — o admin vê uma coisa e o cliente final recebe outra. Não ocorreu agora, mas é uma armadilha para evoluções futuras.

### Preview no `SendMessageDialog` — UI coerente com envio

O preview é derivado de `segmentTemplate(body, previewVars)`, que retorna segmentos marcados como `"text"` ou `"var"`:
- `"var"` → renderizado com `bg-primary/15` (realce de fundo) + `text-foreground` (texto em cor normal).
- `"text"` → sem realce.

**Crítica:** O realce por fundo (não só cor) resolve a preocupação de contraste AAA. O comentário em `SendMessageDialog.tsx` explica que o fundo é camada decorativa e o texto é informação portadora — padrão apropriado de acessibilidade.

O desacoplamento de opções (vêm do enum `MESSAGE_TEMPLATES`, não do fetch) é elegante:
- Admin lê `message_templates` via `useMessageTemplates()` e o preview é renderizado.
- Receptionist/professional não conseguem ler (RLS nega SELECT), mas o `Select` oferece as 4 chaves do enum — então conseguem disparar. O servidor, com service role, resolve o texto real e o DEFAULT_TEMPLATE_BODIES cobre ausência.

**Não-regressão**: Opt-in é preservado; os 5 outcomes continuam no mesmo lugar (idempotência + instância conectada + opt-out + sucesso + falha). A única mudança é `text` que agora é renderizado.

### Migrations — RLS, idempotência, paridade com código

**ADR-01 (`message_templates.sql`)**:
- Schema: `id, tenant_id, template_key, body, active, {created,updated}_at`.
- `unique (tenant_id, template_key)` — impossível ter 2 linhas da mesma chave por tenant no banco.
- Índice em `tenant_id`.
- **RLS**: SELECT + ALL (insert/update/delete) restritos a `admin` do tenant.
- `WITH CHECK` presente — impede cross-tenant.
- **Crítica válida**: O comentário menciona a lesson learned de `20250218090000` (o default `current_tenant_id()` é obrigatório para o WITH CHECK funcionar). Bem feito.

**ADR-02 (`message_templates_baseline.sql`)**:
- `seed_message_templates(p_tenant_id)` com `on conflict ... do nothing` — idempotente, pode rodar N vezes sem duplicar.
- `handle_new_user()` recriado com `create or replace` (ADR-02 chamada atomicamente no signup).
- Backfill para tenants existentes com o mesmo `on conflict` — robusto.
- Textos padrão pt-BR usam a lista fechada de variáveis.
- **Crítica**: O `lembrete_d1` contém "1 confirmar / 2 reagendar" como texto livre — **não há parsing/webhook/cron acoplado**. Prepara a Fatia 2 sem antecipá-la (decisão correta, RF-T09/AC-09 cumprida).

Ambas as migrations são versionadas e não editam migration anterior aplicada (RNF-T04).

### Testes — cobertura do contrato de renderização

`message-templates.test.ts` testa:
- Substituição de variáveis com dados presentes (AC-05): ✅ renderiza corretamente.
- Fallback quando falta dado (AC-06): ✅ nunca sai a variável crua.
- Variável desconhecida mantida literal: ✅ `{foo}` não é substituída.
- `resolveEmpresa()` (trade_name → legal_name → null): ✅ paridade com servidor.
- Segmentação para o preview (concatenação == renderTemplate): ✅ invariante forte.
- Determinismo (RNF-T05): ✅ mesma entrada, mesma saída.

16 testes, todos passam. **Não há testes de RLS**, mas isso é normal — são testados em integração via Supabase local (fora do escopo do vitest). **Não há testes da Edge Function**, mas é aceitável — Deno não tem suite de testes nativa no projeto.

### RBAC e permissões — defesa em profundidade

`usePermissions()` adiciona `canManageMessageTemplates: boolean = isAdmin`. A tela `TemplatesMensagemPage` redireciona para `AccessDenied` se `!canManageMessageTemplates` (defesa em profundidade). A RLS bloqueia a escrita de qualquer outro papel.

O `ConfigHubPage` filtra o atalho com `.filter(shortcut => shortcut.visible !== false)`, mostrando "Modelos de mensagem" só para admin (testável localmente).

**Crítica**: Bem estruturado. Não há caminho cross-tenant do super_admin (coerente com a regra geral de não expor tabelas de domínio ao super_admin pelo cliente).

### Acessibilidade — foco, teclado, contraste

- **Foco visível**: herdado do `focus-visible:ring-2` global (shadcn/ui).
- **Teclado**: `Dialog` reclui foco, `Esc` fecha; chips são `Button` (navegável por Tab).
- **Contraste**: realce por fundo, texto em `foreground` — ratio ≥ 4.5:1 (calculado via HSL do tema).
- **Labels associados**: `FormField` liga `htmlFor`/`id` + `aria-describedby` automaticamente (shadcn).

Sem animações novas além das transições de hover cobertas por `prefers-reduced-motion`.

### Build e TypeScript

- `npm run build` → 0 erros, chunk size warning é conhecido (não causa falha).
- `npm run typecheck` → limpo, sem `any` implícito.
- `npm run test -- --run` → 32 testes passam (2 arquivos).

### Componentes reutilizados — evita duplicação

A tela reutiliza `PageHeader`, `Card*`, `Button`, `Badge`, `Dialog*`, `Form*`, `Skeleton`, `Switch` etc. — nenhum reinventa. O `Textarea` novo é primitivo shadcn padrão (ADR-05 dependency, já adicionado).

Novo primitivo (`TemplateBodyField`, `TemplatePreview`, `VariableChips`) é específico do domínio de templates — não genérico.

### Contrato com a Fatia 2

O `lembrete_d1` aceita "1 confirmar / 2 reagendar" como texto livre. **Nenhuma lógica de webhook/parsing/cron é adicionada** (verificado: não há `handle_message_reply`, não há `pg_cron` job, não há webhook listener novo). RF-T09/AC-09 cumprida — contrato preparado, Fatia 2 não antecipada.

</details>

---

## Conclusão

A ADR-07 está bem executada. O código é limpo, tipado, testado. A renderização é server-side (correto). PII é protegido (correto). RLS mantém isolamento (correto). Não há regressão do fluxo de envio (correto). Acessibilidade está pensada (correto).

Três avisos menores — nenhum bloqueante — foram registrados nas Issues para evolução futura. **A ADR está pronta para QA ao vivo no ambiente local** (supabase start + npm run dev + Chrome DevTools).

**Aprovado para avançar para QA.**

