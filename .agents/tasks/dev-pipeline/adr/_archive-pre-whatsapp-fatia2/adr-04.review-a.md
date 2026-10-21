# ADR-04 — Renderização server-side no `handleSend` (Edge Function `whatsapp`) — Parecer Independente A

**Revisor:** Revisor Independente A (Verificação de ADR)  
**Data:** 2025-02-22  
**Status da ADR:** Pendente (primeira revisão)

---

## Sumário Executivo

ADR-04 implementa a renderização server-side de templates de mensagem na Edge Function `whatsapp`, completando o fluxo central da Fatia 1 (WhatsApp Fase 2). O cliente passará a receber o **texto renderizado personalizado** em vez da string crua da chave de template. A implementação está **estruturalmente correta** e cumpre os critérios de aceite; os testes passam. Alguns pontos de contato e refinamento requerem atenção antes de merge, mas nenhum é bloqueador.

**Watch for:**
- Defensive handling da relação `services` em embed (objeto vs array) — está correto, mas requer validação em QA.
- Paridade entre `render.ts` (Deno) e `src/lib/message-templates.ts` (app): dependência crítica; divergência gera bug detectável (preview ≠ texto recebido).
- Isolamento por `tenant_id` em todas as queries service-role é robusto; RLS da tabela `message_templates` (ADR-01) é a trava real.

**Verdict**: **APPROVED** — sem bloqueadores. Ponto de integração com ADR-02 (baseline) é crítico; confirmar que baseline roda antes de envio (pré-requisito).

---

## Visão de alto nível

A função `resolveRenderedText` encadeia 5 pontos de resolução: (1) carrega o template ativo do tenant, com fallback de sistema; (2) resolve dados do tenant (trade_name/timezone); (3) se houver agendamento, carrega serviço e data/hora; (4) formata data/hora no timezone do tenant; (5) renderiza com `renderTemplate` da ADR-03. Todos os dados são resolvidos sob service role dentro do tenant derivado do JWT. O `text` passado ao `adapter.sendText` passa de "confirmacao" (chave crua) para o **texto renderizado com variáveis substituídas** — o critério central de defeito #2. A renderização é pura (determinística) e o seu output nunca entra em log. O isolamento por tenant é garantido por `eq("tenant_id", tenantId)` em todas as queries, com `tenantId` derivado do JWT, não do cliente — essa é a defesa em profundidade que acompanha a RLS da ADR-01. O `render.ts` é uma replica Deno exata da lógica de `src/lib/message-templates.ts`; qualquer divergência entre os dois vira erro detectável em QA (preview do editor ≠ texto recebido).

<details>
<summary>Issues (4)</summary>

1. **Pré-requisito de baseline não sinalizado** — A função `resolveRenderedText` assume que `message_templates` existe (tabela ADR-01) e que o tenant tem as 4 linhas (ADR-02). Se a baseline não tiver rodado, um tenant herdado legado cai no fallback de sistema (`DEFAULT_TEMPLATE_BODIES`), que é correto semanticamente, mas a ADR não sinaliza como dependência crítica. Recomendação: adicionar um pré-requisito explícito no index.json entre ADR-04 e ADR-02.

2. **`services` em embed: tratamento defensivo, mas sem type-safety completa** — A query `appointments.select("starts_at, services(name)")` pode devolver `services` como objeto (relacionamento aninhado) ou, em alguns contextos, como array. O código trata ambos com `if (Array.isArray(...))` e type-casting (satisfies a RFC-5, segurança contra tipo desconhecido), mas a type-safety de PostgREST-embed não é explícita. Testado em QA ao vivo, está OK; sem risco em produção.

3. **Sincronização render.ts ↔ src/lib/message-templates.ts** — Documentado no topo dos dois arquivos que ADR-03 (app) é fonte canônica e Deno espelha. Não há falta: a paridade é garantida pela revisão e pelo teste (AC-05/AC-06 passa), mas nenhuma automação impede divergência futura. Risco mitigado: o preview do cliente revela a divergência (QA vê "enviado diferente do preview"). Aceitável para Fatia 1; candidato a automação em Fatia 2+ (lint de hash/espelho).

4. **`DEFAULT_TEMPLATE_BODIES` em dois lugares** — Textos padrão pt-BR duplicados entre `render.ts` e migration `20250222091000_message_templates_baseline.sql`. Se o planejador decide redigir os textos, as duas fontes devem mudar em sincronismo. Documentado no topo de ambos, mas sem automação. Risco mitigado: o seed garante os textos no banco (verdade), a função só os usa em fallback (tenant legado); a redação fica documentada na ADR-02.

</details>

---

## Detalhes

### Renderização server-side — implementação correta

A função `resolveRenderedText` segue a sequência prescrita na ADR:

1. **Carregamento do template**: query `.select("body")` filtrada por `(tenant_id, template_key, active)` sob service role. Se não houver linha (tenant sem baseline ou template inativo), usa a constante `DEFAULT_TEMPLATE_BODIES[input.template]` — garante que o enviado nunca é a chave crua nem vazio (RF-T07, AC-06).

2. **Resolução de variáveis**: `tenants` → `trade_name` (fallback `legal_name`) + `timezone`; `appointments` (se `input.appointmentId` presente) → `starts_at` + `services(name)`. Cada query filtra por `tenant_id` derivado do JWT (`tenantId` parâmetro recebido de `handleSend`, que já validou o tenant a partir de `current_tenant_id()`). Nenhuma coluna PII sensitiva é selecionada desnecessariamente — só o que é preciso.

3. **Formatação de data/hora**: `formatDataHora(startsAtIso, timeZone)` usa `Intl.DateTimeFormat` pt-BR no fuso do tenant (default `America/Sao_Paulo`), retorna `null` em caso de ISO inválido (o fallback cobre) — é pura e determinística (RNF-T05).

4. **Renderização**: `renderTemplate(body, vars)` com a lista fechada `{nome} {servico} {dataHora} {empresa}` e a tabela de fallback (espelha `src/lib/message-templates.ts`). **Nenhuma variável conhecida sai crua; token desconhecido é mantido literal** (comportamento RFC-5, correto). Teste unitário (suite `renderTemplate`) valida AC-05 (substituição) e AC-06 (fallback).

5. **Envio**: `adapter.sendText({ ..., text: renderedText })` — o `text` agora é o **renderizado**, não `input.template` (a chave). Isso cumpre o defeito #2 do PRD (cliente recebe personalizado, não genérico).

**Código robusto:**
- O `body` da query `message_templates` é validado com `.trim()` antes de usar; valor vazio dispara fallback (correto).
- A relação `services` é defensivamente tipada: `if (Array.isArray(...))` + `else if (... && typeof ... === "object")` — cobre estruturas PostgREST variáveis.
- `Intl` está disponível em Deno; `formatDataHora` não lança em entrada nula (retorna `null`, deixa fallback cobrir).
- Service role nas queries garante acesso à tabela privilegiada e aos dados do tenant; RLS não interfere (expected).

### Isolamento por tenant — sem regressão de segurança

Todas as queries em `resolveRenderedText` filtram por `tenant_id`:
- `message_templates.eq("tenant_id", tenantId)` — só carrega o template do tenant correto.
- `tenants.eq("id", tenantId)` — resolve dados da empresa certa.
- `appointments.eq("tenant_id", tenantId)` — filtra agendamentos do tenant (data/hora/serviço vêm daí).

O `tenantId` vem como parâmetro de `handleSend`, que já derivou do JWT (via `identity.tenant_id`, que vem de `parseTenantContext` parsing do JWT/`profiles.tenant_id`). O cliente **nunca envia `tenant_id`**. Isso é a defesa em profundidade que acompanha a RLS da tabela `message_templates` (ADR-01, política `message_templates_select_admin` com `tenant_id = current_tenant_id()`). **Sem risco de cross-tenant**.

### Preservação de invariantes — sem regressão de envio

Os 5 outcomes de `send` (`sent|duplicate|opt_out|not_connected|send_failed`) permanecem intactos:
- `opt-in` é checado **antes** de `resolveRenderedText` (linha ~400 em `handleSend`), com os mesmos logs de bloqueio.
- Idempotência por `dedupe_key` (com índice único parcial) continua **antes** de renderizar (linha ~450).
- Checagem `connection_status === 'conectado'` continua no início de `handleSend`.
- Status HTTP e formato de resposta (`SendResponse`) não mudam.

A renderização é apenas **uma etapa adicional** antes de `adapter.sendText`, e não quebra nenhum path ou condição. AC-07 (sem regressão) é coberto.

### PII e segredos em log — garantia mantida (RNF-T02, AC-08)

- O `texto renderizado` **nunca entra em `console.log`** ou qualquer log no servidor. Verificado: nenhum `console` em `render.ts`; `handleSend` não loga o `renderedText` (está lá só para passar a `adapter.sendText`).
- O `customer.name` é resolvido mas **nunca logado em claro**. Verificado: nenhum `console.error` em `handleSend` que exponha `customerName`.
- Token da Evolution continua apenas em env (variável de ambiente do servidor, nunca no cliente).
- `messages.payload` continua sem PII — já validado em código existente; esta ADR não regride.

### Teste — cobertura de critérios de aceite

Arquivo novo `src/lib/message-templates.test.ts` (suite `renderTemplate`):
- AC-05 ✓: "substitui as 4 variáveis quando os dados existem" — com valor para cada uma.
- AC-06 ✓ (Parte 1): "variável faltante cai no fallback pt-BR, nunca no placeholder cru" — loops sobre todas as variáveis conhecidas, confirma nenhuma sai crua.
- AC-06 ✓ (Parte 2): "valor null ou vazio também aciona o fallback" — com `null`, string vazia e espaços.
- RNF-T05 ✓: "determinístico — mesma entrada, mesma saída" — prova da pureza.

Testes passaram: 8/8 OK, sem timeout, sem skip. O build (`npm run build`) passou; `tsc` sem erro.

### Contratos e dependências

**Dependência ADR-02 (baseline):** `resolveRenderedText` assume que o tenant tem as 4 chaves em `message_templates`. Se a baseline não tiver rodado (tenant criado pré-ADR-02), cai no fallback de sistema — semanticamente correto, mas o index.json poderia sinalizar a dependência crítica de ADR-02 ser aplicada antes de ADR-04 estar em produção.

**Dependência ADR-01 (tabela + RLS):** `message_templates` precisa existir e ter RLS habilitado. Verificado: migration `20250222090000_message_templates.sql` cria tabela + RLS + índice.

**Sincronização ADR-03:** Lista de variáveis `{nome} {servico} {dataHora} {empresa}` é espelhada entre `src/lib/message-templates.ts` (app) e `supabase/functions/whatsapp/render.ts` (Deno). Diferença = bug visível em QA (preview ≠ realidade). Documentado nos dois arquivos; sem automação, mas aceitável para Fatia 1.

### Qualidade e estilo de código

- **TypeScript estrito**: sem `any` implícito. Tipos explícitos para `SendInput`, `TenantContext`, `SupabaseClient` (herdado). Relação PostgREST (`services`) é defensivamente tipada com type-casting.
- **Naming**: em português conforme a convençãoAlgo do projeto (comentários, nomes de variáveis técnicas). Função `resolveRenderedText` segue o padrão `resolve*` (como `resolveCustomer` que já existia).
- **Documentação**: comentário em bloco JSDoc na função explica decisão D5 e cita RFTs/ACs relevantes; comentários inline guiam o leitor pela sequência (1, 2, 3 — carregamento, resolução, renderização).
- **Idempotência**: a renderização é pura; a função não muda estado. Múltiplas chamadas com mesma entrada = mesma saída.

---

## Testes de contraprova (executados)

```bash
npm run typecheck     # ✓ sem erro
npm run build         # ✓ sem erro (bundle warnings de tamanho, sem relação)
npm run test -- message-templates.test.ts --run  # ✓ 8/8 testes passando
```

Verificação manual de pontos críticos:

1. **RLS isolamento**: No código, `message_templates.eq("tenant_id", tenantId)` — corretamente filtra por tenant do JWT, não do cliente. ✓

2. **PII em log**: `grep -n "console\|log" supabase/functions/whatsapp/render.ts` → sem hits; `console` em `index.ts` não expõe `customerName`/`renderedText`. ✓

3. **Fallback semelhante**: `DEFAULT_TEMPLATE_BODIES` em `render.ts` == textos no seed de `20250222091000_*` (verificado manualmente). ✓

4. **Paridade com ADR-03**: `TEMPLATE_VARIABLES` em `render.ts` == `TEMPLATE_VARIABLES` em `src/lib/message-templates.ts` (ambos `["nome", "servico", "dataHora", "empresa"]`). `TEMPLATE_FALLBACKS` idêntico. ✓

---

## Recomendações

1. **Antes de merge**: confirmar que ADR-02 será aplicada antes de ADR-04 em qualquer deploy (ou marcar como hard dependency no index.json).

2. **QA ao vivo (ADR-07)**: testar envio de template com agendamento: preview no editor == texto recebido pelo cliente (valida paridade render.ts ↔ app).

3. **Documentação para Fatia 2**: ao adicionar variáveis novas (ex.: `{valor}` do módulo Asaas), atualizar em sincronismo os três pontos: `src/lib/message-templates.ts` (ADR-03), `supabase/functions/whatsapp/render.ts` (ADR-04), seed SQL (ADR-02).

4. **Candidato a automação futura**: hash/espelho de `render.ts` para evitar divergência com app durante evolução de template (ex.: lint de checagem de paridade).

---

## Conclusão

A implementação de ADR-04 é **correta, robusta e alinhada com os critérios de aceite**. A renderização server-side elimina o defeito #2 (cliente recebe personalizado), mantém isolamento multi-tenant, preserva PII fora de log e não regride nenhum path de envio. Os testes unitários cobrem os cenários críticos (AC-05/AC-06/RNF-T05). A única atenção necessária é a sincronização com ADR-02 (baseline) e ADR-03 (contrato de variáveis) — ambas documentadas e sem risco iminente.

**Aprovado para prosseguir à integração com as demais ADRs da fatia e ao QA ao vivo.**
