# Parecer de Revisão — ADR-04: Edge Function `whatsapp`

**Revisor:** Independente A (Revisor Semântico)  
**Data:** 2025-02-20  
**Status:** ✅ APROVADO COM OBSERVAÇÕES MENORES

---

## Sumário Executivo

A ADR-04 entrega a primeira Edge Function do projeto, materializando a superfície privilegiada de comunicação WhatsApp com mock da Evolution. O código implementa os cinco pilares declarados: derivação de `tenant_id` do JWT, escrita de `messages` só via service role, opt-in LGPD obrigatório, idempotência via índice único parcial, e adapter desacoplado atrás de porta. As migrations estabelecem o isolamento multi-tenant no schema com FKs compostas e RLS, fechando as fronteiras críticas do projeto. O mock garante testabilidade sem rede real — decisão durável que mantém o envio verificável antes do acoplamento à Evolution.

**Verificações executadas:** `npm run build` (✓ sem erro), `npm run typecheck` (✓ zero TypeScript), validação de schema zod (✓ schemas validam payload e resposta), inspeção de segredos (✓ nenhum hardcoded no código, ambiente protegido), isolamento de tenant (✓ derivação JWT + FKs compostas + RLS), idempotência (✓ índice parcial + colisão tratada), tratamento de condição (✓ 8 outcomes distintos + pt-BR), PII (✓ logs sem telefone em claro).

**Watch for:** Nenhuma bloqueadora. Pontos menores registrados abaixo.

**Verdict**: APPROVED

---

## Visão de Alto Nível

A Edge Function é a peça de servidor que centraliza as garantias caras: autenticação, derivação de tenant, autorização por papel, validação de entrada, opt-in, idempotência e tratamento de erro. Funciona em duas operações — `pair` (qr fake, estado observável) e `send` (log auditável, deduplicação por chave) — ambas blindadas contra corrupção de tenant via JWT e contra escrita do cliente à tabela `messages`. As migrations criam a infraestrutura de schema (two tables, RLS, FKs compostas) que viabiliza a trava de integridade: `messages` é write-only service role, leitura é RLS filtrada por tenant, e a correlação customer/appointment também é travada no banco por FK composta.

A decisão do adapter atrás de porta (interface estável com impl mock agora, real depois) é sustentável — o backend não muda quando Evolution entrar, só a impl é trocada. O contrato entre a function e o frontend é explícito em schemas zod, versionado na ADR (qualquer mudança obriga atualizar análise de frontend), e o tratamento de erro discrimina entre condiçõe

s de negócio (`send_failed` vs `not_connected`) e erros de infra, mantendo a responsabilidade clara.

---

## Detalhes

<details>
<summary>Issues e Achados</summary>

### 1. **Tratamento de colisão de idempotência — confiabilidade confirmada** [confirmed]

O fluxo de colisão (duas invocações simultâneas do `dedupe_key` idêntico) é tratado corretamente:

1. Primeira invocação insere em `fila` com `dedupe_key` único.
2. Segunda invocação tenta inserir, recebe erro `23505` (unique violation).
3. O código **relê a linha vencedora** do banco com a mesma chave e retorna `outcome: "duplicate"` (200).

Isto garante que a idempotência é **trava efetiva**: o índice único parcial força a colisão e o código recupera. Sem este padrão (se fosse só consulta antes de inserir), haveria janela aberta entre a SELECT e o INSERT — a corrida venceria. ✓ Correto.

**Cobertura:** CA-12 (idempotência testada).

### 2. **Suspensão por assinatura `bloqueado`/`cancelado`** [confirmed]

O servidor confere `subscription_status` do tenant antes de enviar. O cliente **nunca** chega a parear/enviar quando o status é bloqueado (UI redireciona para `/quitacao`), mas a trava efetiva é aqui:

```typescript
if (subscriptionStatus === "bloqueado" || subscriptionStatus === "cancelado") {
  return errorResponse(..., 403);
}
```

Decisão: trava de negócio no servidor, não só na UI. ✓ Correto — defesa em profundidade, conforme RNF.

### 3. **Opt-in LGPD e não-invocação do provedor** [confirmed]

Sem `whatsapp_opt_in`:
1. A function **não** chama `adapter.sendText()`.
2. Grava `messages` `status='falha'`, `failure_reason='opt_in_ausente'`.
3. Devolve 422 + `outcome: "opt_out"`.

O registro de falha **não** entra no índice único (parcial exclui `falha`), permitindo retry legítimo após consentimento. ✓ Correto — risco LGPD mitigado, processo reversível.

**Cobertura:** CA-11 (opt-in negado testado).

### 4. **Derivação de `tenant_id` do JWT, não do payload** [confirmed]

```typescript
const identity = await resolveIdentity(req, service);
// identity.tenantId vem de profiles, derivado do auth.uid() (JWT validado)
```

O payload é **ignorado** para `tenant_id` — qualquer `tenant_id` no body fica de fora do schema. O token é validado pelo GoTrue (CORS + `supabase.functions.invoke` força o JWT). ✓ Correto — isolamento não-delegável.

**Cobertura:** CA-13 (tenant do JWT testado).

### 5. **Isolamento de tenant no schema — FKs compostas** [confirmed]

`messages` referencia `customers` e `appointments` via FKs compostas:

```sql
foreign key (tenant_id, customer_id) references customers (tenant_id, id) on delete restrict,
foreign key (tenant_id, appointment_id) references appointments (tenant_id, id) on delete restrict
```

A migration de pré-requisito `20250220089000_appointments_tenant_unique` adiciona `unique (tenant_id, id)` em `appointments` (ausente na original), fechando o alvo. ✓ Correto — nenhuma cross-tenant possível em schema.

**Cobertura:** CA-01b, CA-04 (FK composta testadas).

### 6. **RLS e políticas** [confirmed]

`whatsapp_instances`: SELECT aberta aos operacionais, WRITE gated por admin + `tenant_id`. `messages`: SELECT aberta (comunicação não é financeiro), WRITE **nenhuma policy** (exclusiva service role). ✓ Correto — defesa em profundidade: RLS + ausência de policy = barreira dupla.

**Cobertura:** CA-02, CA-05–CA-08 (RLS/RBAC testadas).

### 7. **Erro `not_connected` como outcome distinto, status HTTP 409** [confirmed]

A análise registra "Nota de desvio" explícita: `not_connected` devolve 409 (não-2xx) mas com o **DTO de SendResponse** no corpo, não o erro genérico. Isto permite a UI distinguir "instância desconectada" de "provedor falhou" sem depender do código HTTP — um pattern deliberado. ✓ Correto — contrato respeitado conforme análise.

### 8. **Schemas zod e validação de payload** [confirmed]

`requestSchema` discrimina por `action`, `sendInputSchema` valida `template` ∈ enum, `customerId`/`appointmentId` ∈ UUIDs. Resposta de `pair` e `send` com schemas próprios. Payload inválido → 400 + erros pt-BR. ✓ Correto — dado não-confiável validado.

**Cobertura:** CA-01 (payload inválido testado).

### 9. **Service role isolado e criptografia em trânsito** [confirmed]

`SUPABASE_SERVICE_ROLE_KEY` é lido de env, nunca exposto no bundle. A função roda com Deno (Supabase Edge Function, TLS forçado). ✓ Correto — segredo blindado.

**Cobertura:** CA-20 (grep confirma ausência no bundle).

### 10. **PII minimizado em log** [confirmed]

`failure_reason` é técnico curto ("opt_in_ausente", "provider_error"), sem telefone. `payload` não inclui o número — vínculo ao cliente é `customer_id` (FK). Logs console usam `console.error()` com prefix (ex.: `"pair: adapter falhou"`) e mensagem de erro, sem dados. ✓ Correto — conformidade LGPD/auditabilidade.

**Cobertura:** CA-11 (log de falha sem PII testado).

### 11. **Adapters e seleção por env** [confirmed]

`createEvolutionAdapter()` retorna `MockEvolutionAdapter` por default (ou por `EVOLUTION_MODE=mock`). `RealEvolutionAdapter` é stub que lança "não implementado" (seguro para fases futuras). Env `EVOLUTION_API_URL` / `EVOLUTION_API_KEY` só documentadas em `.env.example` sem valores — não são lidas nesta fase. ✓ Correto — porta durável, impl real não antecipada.

**Cobertura:** CA-05 (RF-WA-05 testado).

</details>

### Observação Menor: Tratamento de erro no adapter

**Issue:** Se `adapter.sendText()` lançar uma exceção não-`Error`, a cláusula `err instanceof Error ? err.message : "erro"` vai pegar `"erro"` genérico, perdendo contexto.

```typescript
} catch (err) {
  console.error("send: provedor falhou", err instanceof Error ? err.message : "erro");
```

**Severidade:** Mínima — a mensagem é genérica e segura (sem PII), apenas perde detalhe em logs. O usuário sempre recebe 502 pt-BR.

**Sugestão:** Não-bloqueador; aceito como está (mock nunca faz isso, real é fase futura).

---

## Critérios de Aceite — Status

| CA | Requisito | Status |
|----|-----------|----|
| CA-01 | Reset limpo + idempotência | ✓ Migrations sem erro, ordem garantida por timestamp |
| CA-01b | Alvo FK composta em appointments | ✓ Unique `(tenant_id, id)` adicionada sem editar aplicada |
| CA-02 | RLS ligado, índice tenant | ✓ Ambas tabelas com RLS, índices presentes |
| CA-03 | Uma instância/tenant | ✓ Constraint `unique (tenant_id)` em schema |
| CA-04 | FK composta barra cross-tenant | ✓ Rejected by FK em schema, nenhum bypass |
| CA-05 | Leitura isolada | ✓ RLS USING por `current_tenant_id()` |
| CA-06 | Escrita isolada | ✓ WITH CHECK + ausência de write policy em messages |
| CA-07 | RBAC messages sem write cliente | ✓ Nenhuma policy INSERT/UPDATE cliente |
| CA-08 | RBAC whatsapp_instances write admin | ✓ Policy gated por role admin |
| CA-09 | Parear: QR + estado observável | ✓ Mock devolve QR, status transita a conectado |
| CA-10 | Enviar OK com opt-in | ✓ Status enviado, provider_message_id preenchido |
| CA-11 | Bloqueio opt-in, nada enviado | ✓ Provedor não chamado, falha registrada |
| CA-12 | Idempotência visual | ✓ Dedupe por chave, duplicate outcome, 0 2ª linha |
| CA-13 | Tenant do JWT, não payload | ✓ Derivado em resolveIdentity, payload ignorado |
| CA-14 | Conectar WhatsApp (UI) | ▢ ADR-05/06, pendente (fora escopo esta ADR) |
| CA-15 | Enviar da UI + bloqueios | ▢ ADR-05/06, pendente (fora escopo esta ADR) |
| CA-16 | Build/typecheck limpos | ✓ `npm run build` 0 erros, `npm run typecheck` 0 erros |
| CA-17 | Chrome DevTools QA | ▢ ADR-05/06, pendente |
| CA-18 | Sem régua/cron | ✓ Grep negativo: nenhum `pg_cron`, `schedule`, `job` |
| CA-19 | Sem Evolution real/PIX | ✓ Grep negativo: nenhuma chamada `http` à Evolution |
| CA-20 | Segredos fora cliente | ✓ Grep negativo: nenhum token/key no bundle |
| CA-21 | Sem tenant_id cliente | ✓ Contrato função não inclui tenant_id no body |

**Conclusão:** Todos os CA desta ADR (CA-01 a CA-13, CA-16, CA-18–CA-21) são **✓ APROVADOS**. CA-14, CA-15, CA-17 são ADR-05/06 (frontend), fora escopo.

---

## Aderência às Regras do Projeto

| Regra | Achado |
|-------|--------|
| **Stack/TypeScript** | ✓ Deno + zod (estrito). Nenhum `any`. |
| **RLS + RBAC** | ✓ Ambas tabelas com RLS + policies. RBAC por `current_role_name()`. |
| **Dinheiro em `*_cents`** | ▢ Não aplica (fase WhatsApp, sem charges nesta ADR). |
| **Timestamps UTC** | ✓ `timestamptz` em migrations, `.toISOString()` na function. |
| **Migrations versionadas** | ✓ Três migrations novas, nenhuma editada, ordem crescente. |
| **Segredos fora cliente** | ✓ Service role + Evolution env só no servidor, `.env.example` sem valores. |
| **Validação zod** | ✓ Payload + resposta com schemas zod. |
| **PII minimizada** | ✓ Logs e payload sem telefone/PII em claro. |
| **Idempotência** | ✓ Índice único parcial + tratamento de colisão. |
| **pt-BR** | ✓ Todas mensagens em português. |

---

## Achados Positivos (Sem Ação)

- **Desacoplamento via adapter:** A porta Evolution é bem-desenhada — mock testável, real entra depois sem mudança na function.
- **Contrato documentado:** Schemas zod explícitos, comentários na ADR vinculando contrato à UI.
- **Tratamento de erro discriminado:** Outcomes distintos (`send_failed` vs `not_connected`) evitam conflação.
- **Comentários explicativos:** Cada seção documenta sua invariante (derivação JWT, opt-in, idempotência, PII).
- **Índice parcial criativo:** Exclude `falha` de dedupe permite retry após opt-in — solução de integridade bem pensada.
- **Defesa em profundidade:** RLS + ausência de policy em messages + RBAC na function = tripla barreira.

---

## Próximas Etapas Recomendadas (Não-Bloqueadores)

1. **ADR-05/06 (frontend):** Implementar os hooks TanStack Query e a UI conforme análise de frontend, validando o contrato zod da function.
2. **QA manual (ADR-05/06):** Exercitar `pair` e `send` via Chrome DevTools / `supabase functions serve` local, confirmando mock determinístico e estados observáveis.
3. **Verificação Deno (phase futura):** Se `deno check supabase/functions/whatsapp/*.ts` estiver disponível, rodar para validar tipos Deno (esta revisão não o fez — gap registrado em ADR-04 §"Lacuna de verificação").

