# Revisão A — ADR-01: Regra de normalização E.164-BR na borda do servidor

**Status**: NEEDS_CHANGES — Críticas bloqueantes detectadas.

## Sumário

A ADR-01 propõe uma defesa-em-profundidade normalizando números de telefone para E.164-BR (com DDI 55) antes do envio à Evolution, cobrindo registros legados gravados sem DDI. O servidor (Edge Function) implementou corretamente o helper `normalizePhoneForEvolution` e `applyBrDdi`, com assinatura pura, determinística e sem logs de PII — exatamente conforme especificado.

Porém, o **critério de aceite RF-E164-05 foi violado**: a demanda exige um único helper compartilhado entre cliente e servidor. O frontend não consumiu a normalização — o `customerSchema.phone` só remove separadores e valida com E164_REGEX genérica, permitindo números nacionais de 11 dígitos sem DDI serem gravados em `customers.phone`. Isso deixa a origem do código (ponta B, frontend) fracassando; o recurso depende de ambas as ADRs (01 e 02) funcionarem conjuntamente.

**Watch for**: 
1. (confirmed) Frontend não normaliza telefone para E.164-BR — permite gravar `47992391751` sem DDI.
2. (confirmed) Helper do servidor existe mas não é compartilhado com o frontend — viola o requisito de contrato único (RF-E164-05).
3. (likely) ADR-02 (cadastro do cliente, frontend) vai falhar no aceite se não implementar a mesma regra.

## High-level view

O servidor implementou a normalização defensiva de borda corretamente: `normalizePhoneForEvolution` é puro (sem rede, sem PII em logs), segue a tabela de casos especificada e garante que números legados sem DDI chegam à Evolution com `55` prefixado. A infra de credenciais, cliente HTTP com timeout e validação de resposta com zod também está em ordem — defesa profunda contra dados não confiáveis.

O problema é que a ADR-01 é a primeira de um par (ADR-01 servidor, ADR-02 frontend). A tabela de casos de normalização é a **especificação canônica** que ambas devem respeitar idêntica, conforme ADR-01 §"Decisão de mecanismo de compartilhamento". O frontend recebeu a responsabilidade de reproduzir a mesma regra no `customerSchema`, mas deixou em branco: o schema aceita números nacionais de 11 dígitos cru, sem prefixar `55`. Isso viola o critério de aceite AC-01-a (legado 11 díg → `5547992391751`), que é testável no frontend.

A decisão tomada (duas implementações com uma tabela de casos) é válida e está bem documentada. O problema é que a implementação do frontend não foi feita — a ADR-01 saiu com código servidor apenas, deixando a ADR-02 sem a especificação consumível de outro lado. Como RF-E164-05 exige que a regra **não divirja** entre as pontas, e o frontend não implementou nada, há divergência por omissão.

<details>
<summary>Issues (3)</summary>

1. **Frontend não implementa normalização E.164-BR** — O `customerSchema.phone` (em `src/lib/validations/scheduling.ts`) não adiciona DDI 55 para números nacionais de 10–11 dígitos. Aceita e grava `47992391751` (11 díg) diretamente, violando RF-E164-01 e AC-02. A validação E164_REGEX genérica (`/^\+?[1-9]\d{7,14}$/`) permite nacionais sem DDI — precisa adicionar um `transform` que aplique `applyBrDdi` antes do `refine`.

2. **Helper de normalização não é compartilhado com o frontend** — `normalizePhoneForEvolution` vive no servidor (`supabase/functions/whatsapp/evolution-adapter.ts`) como função pura, mas o frontend não o importa nem reimplementa a mesma lógica. Viola RF-E164-05 (regra compartilhada não deve divergir). Ainda que a ADR permita duas implementações, elas devem ser provadamente idênticas; aqui uma ficou faltando. Solução: mover `applyBrDdi` para um arquivo compartilhado (ex.: `src/lib/phone-utils.ts` ou criar um módulo comum) e usá-lo nos dois lados, **ou** implementar `applyBrDdi` também no `customerSchema.phone` zod refine com exatamente o mesmo código.

3. **Regressão de garantia de contrato** — A ADR-01 define como dona da especificação (§"Decisão") e a ADR-02 espelha. O código servidor está correto, mas sem a implementação do frontend, a regra canônica fica só na borda (A) e não protege a origem (B). Clientes gravados via formulário continuam sem DDI. AC-02 testável ("Cadastrar cliente digitando `47992391751` grava `+5547992391751`") não passa — ficaria pendente até ADR-02.

</details>

## Análise detalhada

### Implementação do servidor (correto)

O arquivo `supabase/functions/whatsapp/evolution-adapter.ts` implementa:

- **`applyBrDdi(digits: string)`** — helper puro que aplica a regra E.164-BR exatamente conforme a tabela: 10–11 dígitos → prefixa `55`; 12–13 → mantém; outros → devolve como está. Sem lançar exceção (conforme especificado: "não valida/rejeita").
- **`normalizePhoneForEvolution(to: string)`** — função de borda que remove não-dígitos e aplica `applyBrDdi`.

Ambas são puras e determinísticas (sem rede, sem relógio, sem segredo). O JSDoc está correto e reflete a mudança de contrato: `to` agora é garantido chegar com DDI 55 na Evolution.

Não há logs do número em claro — conformidade com RNF-E164-01.

A função é chamada em `RealEvolutionAdapter.sendText` (visto no diff) antes de compor o POST: `const number = normalizePhoneForEvolution(params.to)`.

**Aceite AC-01 do lado servidor será passível de verificação na ADR-04 (QA ponta-a-ponta).** Aqui, a implementação está certa.

### Implementação do frontend (incompleta)

O arquivo `src/lib/validations/scheduling.ts` define `customerSchema.phone`:

```typescript
phone: z
  .string()
  .trim()
  .transform((value) => value.replace(/[\s()\-.]/g, ""))
  .refine((value) => E164_REGEX.test(value), {
    message: "Informe um telefone válido (ex.: +5511999998888).",
  }),
```

O `transform` remove separadores (parênteses, hífens, espaços) — comportamento esperado. Mas o `refine` valida contra `E164_REGEX = /^\+?[1-9]\d{7,14}$/`, que **aceita números nacionais de 11 dígitos sem DDI**: `47992391751` (11 dígitos começando com 4, primeiro não-zero) passa no regex.

Resultado: um cliente digitando `(47) 99239-1751` será validado e gravado em `customers.phone` como `47992391751` (sem DDI 55).

Esperado pela ADR-01 e AC-02: deveria gravar `5547992391751`.

**Violações identificadas**:

1. **RF-E164-01 (B):** Validação e normalização para E.164-com-DDI não implementada.
2. **AC-02:** Cadastro de cliente não grava com DDI.
3. **RF-E164-05:** Regra de normalização diverge entre origem (B) e borda (A). Borda prefeixa DDI; origem (B) não.

### Impacto na ADR-02

A ADR-02 depende de ADR-01 (relação de dependência documentada). ADR-02 é "Normalização E.164-BR no cadastro/edição de cliente (schema zod)" — exatamente o que deveria corrigir a origem (B). Mas ADR-02 **reusa** AC-02 de ADR-01: "Cadastrar cliente digitando ... grava ... com DDI". Se ADR-01 não apresentar isso ao seu escopo (origem + borda), ADR-02 herdará o defeito ou terá que reimplementar no mesmo lugar (código duplicado).

Espera-se que este parecer (ADR-01.review-a) bloqueie a aprovação até que o frontend implemente a mesma regra. Ou o planejador/implementador decide que ADR-01 cobre **só** servidor (apenas a borda), e ADR-02 é a **dona** da origem — nesse caso, a documentação da ADR-01 deve ser ajustada (ela afirma ser dona de ambas por meio da tabela canônica).

### TypeScript, build, testes

- `npm run typecheck` → passa limpo.
- `npm run build` → sucesso (Vite, 0 erros).
- Sem suíte de testes executável no projeto (conforme análise-data §6). A verificação dos ACs 01–01-f (tabela de casos do helper) seria trivial se houvesse test runner Deno/Node, mas o critério da ADR é "inspeção determinística do helper puro", que é satisfeito: o código de `applyBrDdi` corresponde exatamente à tabela. **A tabela de teste deveria estar documentada ou replicada em comentário**, tanto em `evolution-adapter.ts` (feito) quanto em `src/lib/validations/scheduling.ts` (não feito — ficou em branco).

### Segurança / multi-tenant / PII

- ✅ Sem log de telefone em claro (RNF-E164-01).
- ✅ RLS intacto; `tenant_id` do JWT preservado.
- ✅ Service role key não vaza.
- ✅ Sem parâmetro de `tenant_id` do cliente no fluxo.

Nenhum problema de segurança ou isolamento detectado.

### Edição/migrations/schema

- Nenhuma migration nova de schema — correto, não é necessária.
- Nenhuma política RLS alterada — correto.
- Sem mudança no CHECK de `customers.phone` — correto (borda cobre legados).

## Recomendação

**A ADR-01 (lado servidor) está implementada corretamente**, mas **não atende o critério de aceite RF-E164-05 / AC-02 sozinha**. A ADR-02 (frontend) é necessária para completar a especificação.

**Bloqueios:**

1. **Implementar a mesma regra de normalização no `customerSchema.phone`** (em `src/lib/validations/scheduling.ts`):
   - Opção A: Importar `applyBrDdi` do servidor → requer module resolution entre Vite e Deno (complexo, frágil).
   - Opção B: Replicar `applyBrDdi` em um arquivo comum (`src/lib/phone-utils.ts`), importável por ambos (Vite e Deno podem não concordar no import). **Recomendado**: criar a função em `src/lib/phone-utils.ts` e importá-la em ambos (`src/lib/validations/scheduling.ts` no frontend e `supabase/functions/whatsapp/evolution-adapter.ts` no servidor).
   - Opção C: Reimplementar `applyBrDdi` **identicamente** no `customerSchema`, com um comentário referenciando a tabela da ADR-01 (menos manutenível, mas possível se o projeto não admitir imports cross-runtime).

2. **Documentar a tabela de casos de teste compartilhada** também em `src/lib/validations/scheduling.ts`, não só em `evolution-adapter.ts`. Isso garante a invariante "mesma especificação, mesma implementação".

3. **AC-02 deve passar após a implementação**: cadastro de cliente com `(47) 99239-1751` grava `+5547992391751` (ou `5547992391751` sem o `+`, se o banco armazena sem `+` — conferir migração).

Esta ADR-01 pode avançar para **aprovação condicional**: o servidor está correto, mas aguardando a conclusão de ADR-02 (que revisa este parecer como "já pronto no servidor, falta frontend sincronizar").

## Veredito

**NEEDS_CHANGES** — Bloqueantes:
1. Frontend não implementa `applyBrDdi` no schema de validação.
2. Violação de RF-E164-05 (regra compartilhada).
3. AC-02 não passa no escopo desta ADR.

Recomendação: corrigir o frontend como descrito, validar que AC-02 passa, e reavaliar.
