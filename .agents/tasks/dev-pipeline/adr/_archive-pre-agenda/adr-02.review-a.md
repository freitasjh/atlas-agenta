# ADR-02 Review — Normalizacao E.164-BR no cadastro de cliente

**Revisor:** Revisor Independente A  
**Status:** ✅ APROVADO  
**Build:** ✅ PASS (tsc + vite build clean)  
**Typecheck:** ✅ PASS (strict, sem `any` implícito)

---

## Resumo executivo

A ADR-02 implementa corretamente a normalização E.164-BR no lado do cliente (cadastro/edição de cliente), espelhando a especificação canônica da ADR-01 com precisão. O helper `toE164BR` é puro e determinístico; o schema zod está bem estruturado; TypeScript estrito sem exceções. Não há regressões em RLS, RBAC, multi-tenant ou segurança. A copy UX foi aprimorada de forma apropriada. Nenhum bloqueador.

## Veredito

**APROVADO** para merge. A implementação atende todos os critérios de aceite (AC-02-a até AC-02-f), segue as convenções do projeto (React+TypeScript estrito, zod+react-hook-form, shadcn/ui) e não viola nenhuma fronteira inviolável (RLS, multi-tenant, RBAC, isolamento de tenant_id do JWT, PII em log).

---

## High-level view

**Helper puro `toE164BR`** em `src/lib/phone.ts` normaliza números BR digitados (forma livre) para E.164-BR canônico (`+55` + DDD + assinante). A especificação — tabela de casos por comprimento (10/11 díg nacional → prefixa `55`; 12/13 díg com `55` → mantém; inválido → `null`) — é idêntica à ADR-01 (borda do servidor), como exigido por RF-E164-05. Nenhuma divergência de regra entre as duas pontas.

**Schema `customerSchema`** em `src/lib/validations/scheduling.ts` usa o helper no `transform` (normaliza a entrada) seguido de `refine` (valida e sinaliza `null` como erro pt-BR). O tipo inferido `CustomerInput.phone` permanece `string` (sem `any` ou `string | null` vázio), aplicando TypeScript estrito. Mensagem de erro pt-BR ("Informe um telefone com DDD...") apropriada, sem jargão técnico.

**Componente `CustomerFormDialog`** reaproveitou o schema existente sem mudança na UI estrutural. Apenas duas evoluções de UX (não bloqueantes): placeholder mantido `(11) 99999-8888`, `FormDescription` atualizada para deixar claro que o DDI é assumido automaticamente ("Assumimos o Brasil (+55) automaticamente"). Sem novo token visual, sem regressão de acessibilidade.

**Formatação de exibição** via `formatPhoneForDisplay` já existia e aproveita a normalização automática: números agora nascem com DDI no banco, então o helper renderiza `+55 (47) 99239-1751` corretamente onde antes renderizava cru. Melhoria de UX sem código novo no componente.

**Isolamento preservado**: RLS/multi-tenant não são tocados. `useCreateCustomer`/`useUpdateCustomer` não enviam `tenant_id` (RLS o deriva do JWT). O `canManageCustomers` (RBAC) permanece inalterado. Nenhum parâmetro de tenant vindo do cliente foi introduzido.

---

<details>
<summary>Issues (0)</summary>

Sem problemas bloqueadores ou material de ação. Seção vazia intencional: a implementação é conforme.

</details>

<details>
<summary>Details</summary>

### 1. Helper `toE164BR` — conformidade com especificação da ADR-01

**Confirmado:** O helper implementa corretamente a tabela de casos fixada na ADR-01:

- 10/11 díg (nacional sem DDI) → prefixa `55`: ✅
  - `"(47) 99239-1751"` → remove não-dígitos → `"47992391751"` → `len === 11` → `"+5547992391751"`
  - `"(11) 3322-4455"` → `"1133224455"` → `len === 10` → `"+551133224455"`

- 12/13 díg começando com `55` (já com DDI) → mantém: ✅
  - `"5547992391751"` (após entrada) → `len === 12` && `startsWith("55")` → `"+5547992391751"`
  - `"55 47 99239-1751"` → remove não-dígitos → `"5547992391751"` → idem

- Caso de borda (DDD 55): ✅
  - `"+55 55 999887766"` (DDD 55 com DDI) → `"5555999887766"` → `len === 13` && `startsWith("55")` → `"+5555999887766"` ✓
  - `"55999887766"` (DDD 55 nacional 11 díg) → `len === 11` → prefixa → `"+5555999887766"` ✓
  - Fronteira por comprimento (não por prefixo) está certa; o JSDoc documenta isso de forma clara.

- Idempotência (AC-02-c): ✅
  - `toE164BR("+5547992391751")` → remove `+` → `"5547992391751"` → `len === 12 && startsWith("55")` → `"+5547992391751"` (no-op, não duplica `55`)

- Comprimento inválido → `null`: ✅
  - `toE164BR("123")` → `digits.length = 3` → não é 10/11/12/13 → `return null`
  - `toE164BR("1234567890123456")` (16 díg) → `return null`
  - O schema interpreta `null` como falha, mensagem pt-BR: ✅

**JSDoc preciso:** O comentário reflete a ADR-01 com precisão, nomeando-a como dona da especificação e explicando a fronteira de comprimento (evita confusão com o caso DDD 55).

---

### 2. Schema `customerSchema` — transformação e validação

**Confirmado:** A cadeia `transform` → `refine` está estruturada corretamente:

```typescript
phone: z
  .string()
  .trim()
  .transform((value) => toE164BR(value))
  .refine((value): value is string => value !== null, {
    message: "Informe um telefone com DDD (ex.: (11) 99999-8888).",
  }),
```

1. **Entrada:** string com espaços/hífens/parênteses (forma BR).
2. **`trim()`:** remove espaços em branco nas pontas.
3. **`transform` via `toE164BR`:** normaliza para E.164-BR ou `null`.
4. **`refine` com type guard:** valida que o resultado é `string` (não `null`), rejeitando com erro pt-BR se for.
5. **Tipagem estrita:** o `z.infer<typeof customerSchema>` produz `CustomerInput { phone: string }` — sem `string | null`, sem `any`.

Sem `Any implícito` (build + typecheck passam limpo).

**Mensagem pt-BR apropriada:** "Informe um telefone com DDD..." não expõe jargão (E.164, normalização), mantém tom direto e explica o que o usuário precisa fazer (digitar DDD + número).

---

### 3. Componente `CustomerFormDialog` — reuso sem regressão

**Confirmado:** O formulário reaproveitou o schema sem quebras:

- `react-hook-form + zodResolver(customerSchema)`: ✅ padrão do projeto.
- `useCreateCustomer` / `useUpdateCustomer` (TanStack Query `useMutation`): ✅ nenhum `fetch` solto em `useEffect`; padrão inalterado.
- shadcn/ui `FormField`/`FormControl`/`FormDescription`/`FormMessage`: ✅ componentes reaproveitados, sem recrear.
- Acessibilidade: `label` associado, `aria-label` no switch de opt-in, mensagem de erro no `FormMessage` (não só cor): ✅
- Mobile-first: input `type="tel"` + `inputMode="tel"` (já estava): ✅ facilitam entrada numérica em mobile.

**UX melhorada (não bloqueante):**
- `FormDescription` do campo telefone evoluiu de `"Com DDD. É para onde vão as mensagens de WhatsApp."` para `"Com DDD. Assumimos o Brasil (+55) automaticamente. É o número que recebe as mensagens de WhatsApp."` — explica o DDI assumido sem expor detalhes técnicos.
- Placeholder `(11) 99999-8888` mantido — bom exemplo BR.
- Switch de opt-in (LGPD) com copy clara (`"Só ative com a autorização dele."`) — adequado.

**Nenhuma regressão:**
- RBAC (`canManageCustomers`): não validado neste componente — é feito no guard de página. Inalterado.
- Isolamento tenant: `useCreateCustomer`/`useUpdateCustomer` não enviam `tenant_id`. RLS o deriva do JWT. Inalterado.

---

### 4. Formatação para exibição — aproveitamento de melhoria

**Confirmado:** `formatPhoneForDisplay` em `src/lib/phone.ts` já existia e funciona corretamente com a normalização:

- Entrada: `"+5547992391751"` (E.164 com DDI, agora padrão após normalização no cadastro).
- Lógica: remove não-dígitos → `"5547992391751"` → confere `startsWith("55") && (len === 12 || 13)` → sim → divide em DDD + assinante → formata `+55 (47) 99239-1751`.
- Casos legados (sem DDI): a borda do servidor via `normalizePhoneForEvolution` cobre em tempo de envio; a edição futura de um cliente legado também normaliza. Este helper não precisa defender contra legados no cliente.

---

### 5. Multitenancy e segurança

**Confirmado:** Sem violações de fronteira:

- **RLS preservado**: Tabelas (`customers`, `profiles`) continuam com políticas (`customers_select_same_tenant`, `customers_write_tenant`). RLS não é tocado.
- **`tenant_id` do JWT**: `useCreateCustomer` e `useUpdateCustomer` não enviam `tenant_id`. RLS no banco (`current_tenant_id()`) valida. Nenhum parâmetro de tenant vindo do cliente foi introduzido.
- **RBAC inalterado**: `admin` e `receptionist` continuam autorizados a criar/editar clientes. `professional` continua sem permissão de escrita (já era assim). Nenhuma mudança de policy.
- **PII em log**: o helper `toE164BR` é puro (sem log). O schema zod não loga entrada/saída. O componente não loga telefone. Nenhuma regressão.
- **Segredos do cliente**: Nenhuma chave de API, token ou secret é exposto no código frontend. O helper não toca credenciais. Seguro.

---

### 6. TypeScript estrito

**Confirmado:**
- Build (`tsc -b && vite build`): ✅ passou limpo, sem warnings de tipo.
- Typecheck (`tsc -b`): ✅ sem erros.
- Sem `any` implícito: ✅ `toE164BR` tipado (`(input: string): string | null`), `customerSchema` com `z.infer` exato.
- `refine` com type guard `(value): value is string` garante que o tipo narrowing funciona e `CustomerInput.phone` é `string`, não `string | null`.

---

### 7. Aderência a convenções e stack

- **React + TypeScript + Vite**: ✅ código segue estrutura do projeto.
- **react-hook-form + zod**: ✅ padrão de formulário respeitado; validação declarativa no schema.
- **shadcn/ui**: ✅ componentes reaproveitados (Dialog, Form, Input, Switch, Button, FormMessage).
- **Tailwind + Mobile-first**: ✅ sem novo CSS; reaproveitamento de classes e comportamento mobile via `inputMode`.
- **Português BR**: ✅ labels, placeholders, mensagens e copy em pt-BR, sem mistura de idioma.
- **Sem migrations nem mudança de RLS**: ✅ CHECK de `customers.phone` (8–20 caracteres) não foi alterado. Decisão correta: permite dados legados em repouso; normalização de borda (ADR-01) e cadastro (ADR-02) cobrem em tempo de uso.

---

### 8. Integração com ADR-01 (borda do servidor)

**Confirmado:** As duas pontas espelham a tabela de casos:

- ADR-01 (`applyBrDdi` em `evolution-adapter.ts`): 10/11 díg → prefixa `55`, 12/13 com `55` → mantém.
- ADR-02 (`toE164BR` em `phone.ts`): exatamente a mesma regra.
- Idempotência garantida: origem (cadastro, normaliza) + borda (servidor, normaliza de novo) = sem duplicação de `55`.
- JSDoc da ADR-02 referencia a ADR-01 como dona: ✅ deixa claro onde muda-se a regra (um lugar).

---

### 9. Casos de teste da ADR-02 — conformidade

Inspecionando a lógica do helper contra os ACs:

| AC | Teste | Resultado |
|----|-------|-----------|
| AC-02-a | `toE164BR("(47) 99239-1751")` → `"+5547992391751"` | ✅ |
| AC-02-b | `toE164BR("5547992391751")` → `"+5547992391751"` (sem duplicar) | ✅ |
| AC-02-c | `toE164BR(toE164BR("47992391751")!)` → `"+5547992391751"` (idempotência) | ✅ |
| AC-02-d | `toE164BR("123")` → `null`; schema rejeita com msg pt-BR | ✅ |
| AC-02-e | `toE164BR("(11) 3322-4455")` → `"+551133224455"` | ✅ |
| AC-02-f | Para toda entrada da tabela ADR-01, `toE164BR` (removido `+`) ≡ `applyBrDdi` | ✅ (mesma lógica, runtimes distintos) |

---

### 10. Build/verificação

- **`npm run build`**: ✅ Tsc + Vite clean, bundle gerado sem erros.
- **`npm run typecheck`**: ✅ Sem avisos ou falhas.
- **Lint**: Não configurado no projeto (esperado).
- **Testes automatizados**: Projeto sem suíte de testes (decision conforme `convencoes-codigo.md` — testes não são adicionados automaticamente).
- **Verificação visual/QA ao vivo** (AC-02-a até AC-02-e, incluindo reenvio com cliente normalizado → Evolution não responde 400): é a QA do run (ADR-04), não bloqueador aqui.

</details>

---

## Observações e recomendações

1. **Decisão de duas implementações (cliente + servidor) com uma tabela:** ✅ Apropriada dado os runtimes distintos. A tabela de casos na ADR-01 é a fonte da verdade; o espelhamento é rastreável e testável por inspeção.

2. **Mensagem de erro pt-BR:** Boa decisão de não expor "E.164" ou "DDI" — o usuário final não precisa de jargão. "Com DDD" é claro e conciso.

3. **UX com FormDescription:** Evoluir a copy para "Assumimos o Brasil (+55)..." é um bom refinamento que educa o usuário sem complicar a interface.

4. **Legados sem DDI:** ADR-01 (borda) cobre em tempo de envio. Backfill de dados e aperto do CHECK ficam no backlog (apropriado). A estratégia de defesa-em-profundidade (normalização de borda) deixa o sistema robusto enquanto o cadastro passa a gravar certo.

5. **Sem regressão em testes:** Projeto não tem suíte de testes no cliente (esperado). A lógica do helper é pura o suficiente para testes unitários se/quando adicionados no futuro.

---

## Conclusão

ADR-02 implementa a normalização E.164-BR no cadastro de cliente com exatidão, segurança (sem violação de RLS/RBAC/isolamento multi-tenant) e aderência às convenções do projeto. O helper é puro e determinístico; o schema zod está bem estruturado; TypeScript estrito sem exceções. A UX foi refinada apropriadamente. **Nenhum bloqueador.**

**Parecer: ✅ APROVADO**

