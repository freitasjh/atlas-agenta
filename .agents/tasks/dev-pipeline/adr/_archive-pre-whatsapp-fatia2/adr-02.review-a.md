# Revisão Independente A — ADR-02: Baseline/seed dos 4 templates padrão por tenant

**Revisor:** Revisor Independente A (verificação de contraprova + aderência a critérios de aceite)  
**ADR:** adr-02-baseline-seed-templates.md  
**Branch:** feat/message-templates-schema-rls  
**Data:** 2025-02-22

---

## Sumário

A ADR-02 implementa o seed/baseline idempotente dos 4 templates padrão da régua de mensagens, acoplando-o ao fluxo atômico de signup via `handle_new_user()`. A implementação cumpre todos os critérios de aceite declarados na ADR, segue as convenções do projeto e respeita as fronteiras de segurança (RLS, RNF-T04, RNF-T01, PII/segredo em logs). O código SQL está bem-estruturado, as migrations são idempotentes e a preservação do comportamento anterior de `handle_new_user()` foi fielmente mantida. **Nenhum defeito de aceite foi encontrado.** Build, typecheck e testes passam em green.

**Áreas de confiança:**
- Idempotência de seed e backfill (confirmed via análise do `on conflict` logic).
- Isolamento multi-tenant (reussa helpers `current_tenant_id()`/`current_role_name()`; sem nova RLS aqui, que já vem da ADR-01).
- Preservação do fluxo anterior (handle_new_user corpo fielmente copiado, apenas acrescentado o seed).
- Conformidade com RNF-T04 (migration nova, nunca editando aplicada).
- Redação dos textos padrão (pt-BR, variáveis fechadas, Fatia 2 preparada sem antecipação).

**Achados:** nenhum bloqueador. Recomendações menores sobre futuro documentadas abaixo.

---

## Verificação de Contraprova

### Build / Typecheck / Testes

```bash
$ npm run typecheck
# Exit 0 ✅

$ npm run build
# dist/ gerado, exit 0 ✅

$ npm run test
# 16 tests passed ✅
```

**Conclusão:** projeto compila e roda sem erros.

---

## Aderência aos Critérios de Aceite da ADR-02

### AC-02.1 — Tenant novo nasce com 4 linhas + textos pt-BR não vazios

| Chave | Texto | Variáveis | Status |
|---|---|---|---|
| `confirmacao` | `'Olá {nome}! Seu horário de {servico} na {empresa} está marcado para {dataHora}.'` | 4 variáveis ✅ | ✅ |
| `lembrete_d1` | `'Oi {nome}, lembrete do seu {servico} na {empresa} em {dataHora}. Responda 1 para confirmar ou 2 para reagendar.'` | 4 variáveis + instrução livre ✅ | ✅ |
| `cobranca` | `'Olá {nome}, segue a cobrança do seu {servico} na {empresa}.'` | 3 variáveis ✅ | ✅ |
| `comprovante` | `'Recebemos o pagamento do seu {servico} na {empresa}. Obrigado, {nome}!'` | 3 variáveis ✅ | ✅ |

**Implementação:** Função `seed_message_templates(p_tenant_id uuid)` inserindo as 4 linhas. Chama da função acoplada a `handle_new_user()` após o `insert into profiles`, no mesmo bloco `begin...end` — **fluxo atômico preservado.** ✅

### AC-02.2 — Idempotência / backfill sem duplicatas

Ambos os pontos de inserção usam `on conflict (tenant_id, template_key) do nothing`:

1. **Na função seed:**
   ```sql
   on conflict (tenant_id, template_key) do nothing;
   ```
   (confirmed confirmed em linha 52 da migration)

2. **No backfill de tenants legados:**
   ```sql
   on conflict (tenant_id, template_key) do nothing;
   ```
   (confirmed em linha 118 da migration)

**Teste lógico:** se re-aplicar a migration (ou chamar `seed_message_templates` de novo), o `on conflict` garante que as linhas já existentes não geram erro de duplicate key — re-apply é seguro. ✅

### AC-02.3 — handle_new_user() preservado sem regressão

Comparação entre versão anterior (20250216092000) e nova (20250222091000):

**Antes (20250216092000):**
```sql
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid;
begin
  insert into tenants (...) values (...) returning id into v_tenant_id;
  insert into profiles (id, tenant_id, role, full_name) values (...);
  return new;
end;
$$;
```

**Depois (20250222091000):**
```sql
-- [Código acima, idêntico byte-a-byte]
insert into profiles (id, tenant_id, role, full_name) values (...);

perform seed_message_templates(v_tenant_id);  -- ← ADIÇÃO

return new;
```

**Achado:** o corpo anterior **está preservado fielmente.** A única mudança é a adição de `perform seed_message_templates(v_tenant_id)` antes do `return new`, no mesmo fluxo transacional (dentro do `begin...end` da trigger). Não há regressão — o signup continua criando `tenants`/`profiles` exatamente como antes, apenas acrescido do seed. ✅

### AC-02.4 — Fatia 2 não antecipada (AC-09)

- **Lembrete_d1 redigido com instrução livre:** sim, contém `"Responda 1 para confirmar ou 2 para reagendar."` como **texto literal**, não como lógica executável. ✅
- **Nenhum arquivo de webhook/cron/parsing adicionado:** verificável pelo diff da branch — apenas **duas migrations SQL** são novas; nenhum arquivo `.ts`/`.py`/`.js` de webhook ou cron. ✅
- **Modelagem não fecha porta para evolução:** a coluna `template_key` é um enum de 4 chaves travado no banco (check constraint); a coluna `body` é simples `text`. Adicionar variáveis novas (ex.: `{valor}`) no futuro é apenas questão de acrescentar o fallback na renderização do servidor — a tabela não precisa de esquema novo. ✅

---

## Conformidade com Regras de Fronteira (Segurança Multi-Tenant)

### RNF-T01 — Isolamento multi-tenant

A ADR-02 **não toca em RLS** — ele já foi garantido pela ADR-01. As responsabilidades da ADR-02 são:
1. Função `seed_message_templates()` com `security definer` (roda fora do RLS do chamador, sob privilégios do owner — correto para operações de seed).
2. Acoplamento a `handle_new_user()` (também `security definer`, válido para operação de signup privilegiada).
3. Backfill de tenants legados (sem cliente envolvido, é executado pela migration server-side).

**Achado:** nenhuma vulnerabilidade de cross-tenant introduzida. O isolamento do seed é garantido pelo `tenant_id` sendo passado explicitamente (não derivado do cliente) e pelo `unique (tenant_id, template_key)` constraint da ADR-01. ✅

### RNF-T02 — Segredos e PII em logs

Procura por `RAISE`, `LOG`, output statements no SQL:
```bash
$ grep -i "raise\|log\|print\|exception" supabase/migrations/20250222*.sql
# (sem resultados)
```

**Achado:** nenhuma declaração de log ou debug no SQL. O `body` do template não é segredo nem PII (é texto com placeholders), mas o **texto renderizado com nome do cliente seria PII** — e esse não é logado aqui (é responsabilidade da Edge Function, ADR-04, não desta). ✅

### RNF-T04 — Migration versionada, nunca editando já aplicada

- ADR-02 cria **uma migration nova** com timestamp `20250222091000` (posterior ao último timestamp aplicado `20250221091000`).
- ADR-02 **não edita** a migration anterior `20250216092000_signup_trigger.sql` — em vez disso, usa `create or replace` em uma migration nova para recriar `handle_new_user()`.
- Ambas as migrations são idempotentes: `create or replace function`, `on conflict do nothing`.

**Achado:** conformidade total com RNF-T04. ✅

### RNF-T05 — Determinismo da renderização

A ADR-02 não implementa renderização (isso é ADR-04). Mas a lista fechada de variáveis está travada nos textos: `{nome} {servico} {dataHora} {empresa}`. A renderização será determinística porque as variáveis são conhecidas e o fallback (RF-T07) é definido no PRD.

**Achado:** preparação correta para ADR-04. ✅

---

## Análise de Código SQL

### Migrações

#### 20250222090000_message_templates.sql (ADR-01)

- ✅ `create table if not exists` — idempotente.
- ✅ Colunas e constraints alinhadas com a ADR-01 spec.
- ✅ RLS habilitada; políticas de SELECT/WRITE para `admin` apenas.
- ✅ Índice em `tenant_id` para performance.

#### 20250222091000_message_templates_baseline.sql (ADR-02)

**Função seed:**
```sql
create or replace function seed_message_templates(p_tenant_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into message_templates (tenant_id, template_key, body)
  select p_tenant_id, k.template_key, k.body
  from (values ...) as k(template_key, body)
  on conflict (tenant_id, template_key) do nothing;
end;
$$;
```

- ✅ `security definer` — roda sob privilégios do owner, bypassa RLS (correto para seed).
- ✅ `set search_path = public` — evita injeção via search_path.
- ✅ Parâmetro tipado (`p_tenant_id uuid`) — não está hardcoded.
- ✅ `on conflict do nothing` — idempotente.

**Função handle_new_user:**
```sql
create or replace function handle_new_user()
returns trigger
...
  insert into tenants (...) values (...) returning id into v_tenant_id;
  insert into profiles (...) values (...);
  perform seed_message_templates(v_tenant_id);  -- ← Novo
  return new;
```

- ✅ Corpo anterior preservado fielmente.
- ✅ Acoplamento do seed ocorre no mesmo bloco transacional.
- ✅ Acoplamento ocorre **após** o `insert into profiles` — garante que `v_tenant_id` está definido e o profile foi criado antes do seed.

**Backfill:**
```sql
insert into message_templates (tenant_id, template_key, body)
select t.id, k.template_key, k.body
from tenants t
cross join (values ...) as k(template_key, body)
on conflict (tenant_id, template_key) do nothing;
```

- ✅ Cross join entre `tenants` e as 4 chaves — gera 4 linhas por tenant.
- ✅ `on conflict do nothing` — idempotente ao re-aplicar.
- ✅ Filtrado implicitamente: só tenants que existem em `tenants` recebem seed (não há risco de órfão).

### Textos padrão pt-BR

Todos os 4 textos:
1. Usam a lista fechada de variáveis (`{nome} {servico} {dataHora} {empresa}`) — nenhuma variável extra.
2. São não vazios (lenght > 0).
3. Fazem sentido gramáticalmente e para o caso de uso (confirmação, lembrete, cobrança, comprovante).
4. `lembrete_d1` contém a instrução de Fatia 2 (`1 confirmar / 2 reagendar`) como texto livre — sem parsing acoplado.

**Achado:** textos alinhados com a decisão de redação da ADR-02. ✅

---

## Verificação Contra Defects do PRD

O PRD define 4 defects a evitar (§1):

### Defeito #1: Template vazar entre tenants (falha de RLS)

A ADR-02 **não implementa RLS** — fico já foi garantido pela ADR-01 (policies de SELECT/WRITE para `admin` apenas). A ADR-02 só popula dados. A coluna `tenant_id` é explícita em todos os pontos (`p_tenant_id` na função, `t.id` no backfill) — nenhuma chance de tenant vazar entre si via seed.

**Achado:** defeito #1 mitigado pela ADR-01; ADR-02 preserva isolamento. ✅

### Defeito #2: Quebrar o envio sob demanda atual (regressão do fluxo `send`)

A ADR-02 é puramente de dados (seed). O contrato de `send` fica intacto até a ADR-04 (renderização no servidor).

**Achado:** defeito #2 não atingido por esta ADR. ✅

### Defeito #3: Renderizar variável não resolvida sem controle

A ADR-02 só define os textos dos templates. A renderização é responsabilidade da ADR-04. O fallback (RF-T07) é definido no PRD.

**Achado:** defeito #3 não atingido por esta ADR. ✅

### Defeito #4: Expor segredo/PII em log

Procura por logs em SQL: nenhum `RAISE`, `LOG`, output. O `body` não é segredo. Os dados da migration são all public (nomes de variáveis, textos de template).

**Achado:** defeito #4 não atingido por esta ADR. ✅

---

## Recomendações

Nenhuma recomendação bloqueadora. Itens menores para futuro:

1. **Documentação de fallbacks (para ADR-04 e dev):** quando a renderização da ADR-04 procurar pelo template, se a linha faltar (tenant legado sem baseline), o servidor usa um fallback de "texto de sistema padrão" — esse contrato está documentado na analysis-data.md mas não no SQL da migration. Para futuro, considerar adicionar um comment SQL documentando esse fallback como rede de segurança.

2. **Teste de integração de signup (para QA):** o critério de aceite "tenant novo nasce com 4 linhas" é verificável em testes de integração (fazer signup, verificar query). Recomenda-se que o QA da ADR-02 inclua esse teste prático (chrome-devtools + browser mock) antes de aprovação final.

3. **Alinhamento do contrato de renderização (para ADR-04):** a tabela de fallback de variáveis (RF-T07) precisa estar sincronizada entre o preview do cliente (ADR-05), o render do servidor (ADR-04) e o backend-util compartilhado (ADR-03). Nesta ADR tudo está correto; na ADR-04 a atenção é redobrada.

---

## Conclusão

A ADR-02 implementa o baseline/seed dos 4 templates padrão com qualidade de produção:

- **Critérios de aceite:** todos cumpridos (AC-02.1, AC-02.2, AC-02.3, AC-09).
- **Segurança:** isolamento multi-tenant preservado; nenhuma PII/segredo em logs.
- **Conformidade RNF:** idempotência (RNF-T04), determinismo (RNF-T05), isolamento (RNF-T01).
- **Compatibilidade:** regressão zero em `handle_new_user()`; fluxo anterior preservado fielmente.
- **Qualidade de código:** SQL bem-estruturado, nomes claros, comments explicativos.

**Veredito: APROVADO.** A ADR-02 está pronta para merge e para avançar para a ADR-03 (contrato de renderização compartilhado).

