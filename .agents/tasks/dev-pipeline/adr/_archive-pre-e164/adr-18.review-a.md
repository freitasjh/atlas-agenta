# Review ADR-18 — Revisor A (Independente)

**ADR:** `adr-18-pair-para-em-aguardando-qr-handlecheck.md`

**Status:** ✅ **APPROVED**

**Revisado em:** 2026-10-20

---

## Sumário

ADR-18 implementa a correção de causa-raiz para o bug OQ-01 (QR Code do WhatsApp nunca visível). Remove o resíduo do mock que marca `conexão_status='conectado'` no `pair` real e adiciona uma nova action `check` que reconcilia o estado efetivo da Evolution com a linha persistida. A implementação está correta, segue as fronteiras de isolamento multi-tenant, valida dados externos com zod, trata erros de forma apropriada, e integra-se corretamente com a porta `EvolutionAdapter` definida na ADR-17. **Nenhum defeito encontrado.**

---

## Critérios de Aceite — Resultado

| Critério | Status | Notas |
|---|---|---|
| **CA-18.1 (boot)** | ✅ PASS | `npm run typecheck` limpo; estrutura de imports e rotas correta. |
| **CA-18.2 (`pair` honesto)** | ✅ PASS | Bloco "Pareamento simulado conclui" removido; `handlePair` retorna `aguardando_qr` + `qr_code_base64`; nunca `conectado`. |
| **CA-18.3 (RBAC/roteamento)** | ✅ PASS | Roteamento de `action === "check"` implementado; `handleCheck` exige `role === "admin"` com 403 estruturado. |
| **CA-18.4 (reconciliação)** | ✅ PASS | Condicionado a `state === "open"`; UPDATE com service role; idempotente; SELECT relê e retorna. |
| **CA-18.5 (TS estrito)** | ✅ PASS | `npm run build` limpo; sem `any`; tipos explícitos. |
| **CA-18.6 (segredos)** | ✅ PASS | `EVOLUTION_API_URL`/`EVOLUTION_API_KEY` via `Deno.env`; zero vaza em log/resposta. |
| **CA-18.7 (mock intacto)** | ✅ PASS | `MockEvolutionAdapter.getConnectionState` retorna `{ state: "open" }` para fallback de demo. |
| **CA-18.8 (webhook/régua)** | ✅ PASS | Nenhum webhook de entrada introduzido; só reconciliação de estado de conexão. |

---

## Verificação em Profundidade

### 1. Remoção do Bloco de Mock no `handlePair`

**Confirmado:**
- Linhas 182–198 do código anterior (comentário "Pareamento simulado conclui") foram removidas.
- `handlePair` agora retorna **apenas** `{ connection_status: "aguardando_qr", qr_code_base64 }` (~L188-193).
- Nenhum `.update()` para `conectado` ocorre no caminho real.
- No modo real, `pair` deixa a linha em `aguardando_qr` (upsert ~L163-170), obtém o QR real via adapter, e retorna — fim.

**Implicação:** O frontend receberá `aguardando_qr` e renderizará o QR. ✅

### 2. Nova Action `check` — Lógica e Segurança

**Assinatura (L201-205):**
```typescript
async function handleCheck(
  ctx: TenantContext,
  service: SupabaseClient,
): Promise<Response>
```
✅ Assimétrica com `handlePair` e `handleSend`.

**Autorização (L206-209):**
```typescript
if (identity.role !== "admin") {
  return errorResponse("Você não tem permissão verificar...", 403);
}
```
✅ Admin-only, refletindo que "reconciliar o estado da conexão" é um ato de configuração.

**Derivação de `instanceName` (L214):**
```typescript
const instanceName = `tenant-${tenantId}`;
```
✅ Derivado do JWT (nunca do cliente); segue a convenção de ADR-02.

**Consulta do Estado Real (L217-221):**
```typescript
let realState: Awaited<ReturnType<typeof adapter.getConnectionState>> | null = null;
try {
  realState = await adapter.getConnectionState(instanceName);
} catch (err) {
  console.error("check: adapter falhou", err instanceof Error ? err.message : "erro");
  realState = null;
}
```
✅ Try/catch **engole** a falha (não-fatal). Log limpo, sem corpo cru nem token.
✅ Tipo correto para o retorno da porta.

**Reconciliação Idempotente (L224-233):**
```typescript
if (realState?.state === "open") {
  const { error: updateErr } = await service
    .from("whatsapp_instances")
    .update({ connection_status: "conectado", last_connected_at: new Date().toISOString() })
    .eq("tenant_id", tenantId);
  if (updateErr) {
    console.error("check: falha ao reconciliar estado", updateErr.message);
    return errorResponse("Não foi possível atualizar o estado da conexão.", 500);
  }
}
```
✅ Só atualiza quando `state === "open"`.
✅ Usa `service` (service role), único caminho de escrita de estado.
✅ Gravar o mesmo `conectado` repetido é inócuo (UPDATE sem geração de recurso).
✅ Erro de UPDATE não silencioso — retorna 500.

**Leitura Final (L235-245):**
```typescript
const { data: row, error: readErr } = await service
  .from("whatsapp_instances")
  .select("connection_status, last_connected_at")
  .eq("tenant_id", tenantId)
  .maybeSingle();
if (readErr) {
  console.error("check: falha ao reler instância", readErr.message);
  return errorResponse("Não foi possível consultar o estado da conexão.", 500);
}
return jsonResponse(
  {
    connection_status: (row?.connection_status as string | null) ?? "desconectado",
    last_connected_at: (row?.last_connected_at as string | null) ?? null,
  },
  200,
);
```
✅ Relê a linha após UPDATE (ou após tentar UPDATE).
✅ Retorna `{ connection_status, last_connected_at }` — válido por `checkResponseSchema`.
✅ Fallback para `desconectado` se a linha sumir (improvável, mas defensivo).

### 3. Roteamento no Entrypoint

**Discriminated Union (L505-507):**
```typescript
if (parsed.data.action === "pair") {
  return await handlePair(ctx, service);
}
if (parsed.data.action === "check") {
  return await handleCheck(ctx, service);
}
return await handleSend(parsed.data, ctx, service);
```
✅ Rota `check` interceptada antes do fallback para `send`.
✅ Ordem lógica: `pair` e `check` são operações de configuração, `send` é a operação padrão.

**Parse com `requestSchema` (L500-503):**
```typescript
const parsed = requestSchema.safeParse(rawBody);
if (!parsed.success) {
  const issues = parsed.error.issues.map((i: z.ZodIssue) => i.message);
  return errorResponse("Dados inválidos.", 400, { issues });
}
```
✅ `requestSchema` em `schemas.ts` inclui `checkInputSchema` na discriminated union (linha 55).
✅ Dados não confiáveis validados antes do roteamento.

### 4. Contrato de Fio (schemas.ts)

**Input (L29-32):**
```typescript
export const checkInputSchema = z.object({
  action: z.literal("check"),
});
```
✅ Corpo mínimo: só `{ action: "check" }`.
✅ Nenhum `tenant_id` ou parâmetros adicionais esperados.

**Response (L82-86):**
```typescript
export const checkResponseSchema = z.object({
  connection_status: connectionStatusSchema,
  last_connected_at: z.string().nullable().optional(),
});
export type CheckResponse = z.infer<typeof checkResponseSchema>;
```
✅ Espelha o que `handleCheck` retorna.
✅ `connectionStatusSchema` cobre os três estados: `desconectado|aguardando_qr|conectado`.
✅ `last_connected_at` é timestamptz ISO string (ou nulo).

**Discriminated Union (L51-55):**
```typescript
export const requestSchema = z.discriminatedUnion("action", [
  pairInputSchema,
  sendInputSchema,
  checkInputSchema,
]);
```
✅ `checkInputSchema` está incluído.

### 5. Integração com ADR-17 (EvolutionAdapter)

**Assinatura esperada (evolution-adapter.ts ~L429-435):**
```typescript
async getConnectionState(instanceName: string): Promise<ConnectionStateResult> {
  const credentials = this.credentials();
  const stateRes = await evolutionFetch(credentials, {
    method: "GET",
    path: `/instance/connectionState/${encodeURIComponent(instanceName)}`,
  });
  // ... validação com connectionStateSchema ...
  return { state: parsed.data.instance.state };
}
```
✅ Implementado em ambos `RealEvolutionAdapter` (consulta Evolution) e `MockEvolutionAdapter` (retorna `open`).
✅ Usa `evolutionFetch` com timeout de 15s, credenciais do env, nunca loga corpo cru.
✅ Valida resposta com `connectionStateSchema` (zod, dado não confiável).
✅ Retorna `ConnectionStateResult = { state: EvolutionState }`.

**Consumo em `handleCheck` (L217):**
```typescript
realState = await adapter.getConnectionState(instanceName);
```
✅ Chama corretamente; tipo é `ConnectionStateResult | null` após try/catch.

### 6. Multi-Tenant e RLS

**Isolamento (L214 + L231):**
```typescript
const tenantId = identity.tenantId;  // do JWT
// ...
.eq("tenant_id", tenantId)  // filtro explícito
```
✅ `tenant_id` nunca vem do cliente; derivado de `resolveIdentity()` que lê o JWT.
✅ Filtro `.eq("tenant_id", tenantId)` em SELECT e UPDATE isola dados.

**Service Role para UPDATE (L226):**
```typescript
const { error: updateErr } = await service
  .from("whatsapp_instances")
  .update({ ... })
  .eq("tenant_id", tenantId);
```
✅ `service` foi criado com `SUPABASE_SERVICE_ROLE_KEY` (~L71), bypassa RLS.
✅ É o **único** caminho de escrita de estado de conexão (auditado, sem cliente).

**RLS Intacta:**
- Policies em `whatsapp_instances`: `_select_same_tenant` (leitura) e `_write_admin` (escrita) **não foram modificadas**.
- A leitura final (SELECT em L240) passaria por RLS se fosse de `anon key`, mas roda com service role — retorna a verdade.

### 7. Segredos e PII

**Credenciais (L216):**
```typescript
const adapter = createEvolutionAdapter();
```
✅ `createEvolutionAdapter()` resolve modo e, em `real`, passa `EVOLUTION_API_URL`/`EVOLUTION_API_KEY` de `Deno.env` — nunca do cliente.

**Logs Limpos:**
- L219: `console.error("check: adapter falhou", err instanceof Error ? err.message : "erro");`
  ✅ Sem vazar corpo cru, token, ou QR.
- L232: `console.error("check: falha ao reconciliar estado", updateErr.message);`
  ✅ Motivo técnico curto (Supabase error message genérica).
- L243: `console.error("check: falha ao reler instância", readErr.message);`
  ✅ Limpo.

**Resposta:**
- Nenhum segredo ou PII vazado na resposta (~L244-248).

### 8. Tratamento de Erro

| Cenário | Tratamento | Resposta | Status | Correto? |
|---|---|---|---|---|
| Non-admin chama `check` | Return 403 | `{ error: "Você não tem..." }` | 403 | ✅ Esperado: RBAC. |
| Usuário sem tenant | Return 403 | `{ error: "Usuário sem..." }` | 403 | ✅ Improvável, mas coberto. |
| Evolution fora (adapter erro) | Engole try/catch | `realState = null` | (cont.) | ✅ Não-fatal: retorna estado atual. |
| `state !== "open"` | Sem UPDATE | SELECT retorna `aguardando_qr` | 200 | ✅ Correto: polling continua. |
| `state === "open"` | UPDATE → `conectado` | SELECT retorna `conectado` | 200 | ✅ Correto: transição. |
| UPDATE falha | Return 500 | `{ error: "Não foi..." }` | 500 | ✅ Esperado: infra. |
| SELECT falha | Return 500 | `{ error: "Não foi..." }` | 500 | ✅ Esperado: infra. |

✅ **Cobertura completa e apropriada.**

### 9. Tipagem TypeScript

**Verificação:**
- `npm run typecheck` — ✅ **PASS** (sem erros).
- `npm run build` — ✅ **PASS** (sem erros).
- Variáveis tipadas: `realState: Awaited<ReturnType<typeof adapter.getConnectionState>> | null`.
- Sem `any` visível.
- Discriminated union de `requestSchema` garante que `parsed.data` é tipado por `action`.

### 10. Dependência ADR-17

**O que ADR-17 forneceu:**
1. Porta `EvolutionAdapter.getConnectionState(instanceName): Promise<ConnectionStateResult>`.
2. Schema `connectionStateSchema` para validação.
3. Implementações em `MockEvolutionAdapter` e `RealEvolutionAdapter`.

**Como ADR-18 consome:**
1. Chama `adapter.getConnectionState(instanceName)` (~L220).
2. Confia no tipo `ConnectionStateResult` e no campo `state`.
3. Valida o contrato de resposta implicitamente (zod já validou na porta; aqui só usa).

✅ **Contrato de fio respeitado; ADR-17 não foi violada.**

---

## Pontos de Durabilidade e Invariantes

1. **"A transição de `conectado` só vem de `check` com `state==='open'`"** — invariante de segurança durável que evita "conecta sozinho" no real. Está documentada no código (~L183-185, ~L224) e implementada corretamente.

2. **Idempotência de `check`** — polling ou chamadas repetidas não geram efeito colateral. Confirmado: UPDATE é de estado existente, sem geração de recursos.

3. **Mock intacto** — o fallback de demo (sem rede/celular) continua funcionando. `MockEvolutionAdapter.getConnectionState()` retorna `open`, permitindo que o polling conclua a conexão no modo demo. ✅

---

## Verificação de Frontend (Análise de Dependências)

A ADR-18 (backend) **depende** do frontend fazer:
- Ligar o polling de `useWhatsAppInstance` à nova action `check`.
- Não descartar o QR enquanto `aguardando_qr`.

A ADR-19 cobre isto (frontend). ADR-18 por si só **fornece** a interface (`checkInputSchema` + `checkResponseSchema` em `schemas.ts`) que o frontend precisa consumir. ✅

---

## Verificação de Qualidade

| Aspecto | Status |
|---|---|
| **TS estrito** | ✅ PASS |
| **Build limpo** | ✅ PASS |
| **Typecheck limpo** | ✅ PASS |
| **Sem dependências novas** | ✅ PASS (zod/Supabase já presentes) |
| **Sem segredos no código** | ✅ PASS (env/service role) |
| **RLS/RBAC respeitado** | ✅ PASS |
| **Dados externos validados** | ✅ PASS (zod) |
| **Logs sem PII** | ✅ PASS |
| **Tratamento de erro apropriado** | ✅ PASS |
| **Idempotência** | ✅ PASS |
| **Comentários técnicos claros** | ✅ PASS |

---

## Veredito

✅ **APPROVED — Nenhum defeito encontrado.**

A implementação de ADR-18 está correta e completa:
- Remove integralmente o resíduo do mock que causava o bug OQ-01.
- Adiciona a action `check` de reconciliação com lógica apropriada, segura e robusta.
- Respeita todas as fronteiras de segurança (multi-tenant, RBAC, service role, validação de dados externos).
- Integra-se corretamente com a porta ADR-17.
- Trata erros de forma não-fatal (reconciliação) ou fatal (infra) conforme apropriado.
- Oferece o contrato de fio correto para o frontend (ADR-19).

**Pronto para QA e integração.**

