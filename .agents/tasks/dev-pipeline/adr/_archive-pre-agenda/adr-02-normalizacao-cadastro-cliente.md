# ADR-02 — Normalização E.164-BR no cadastro/edição de cliente (schema zod)

**Status:** proposto

## Contexto

Esta é a ponta (B) do recorte A+B. O formulário de criar/editar cliente
(`src/app/clientes/CustomerFormDialog.tsx`) usa `react-hook-form` +
`zodResolver(customerSchema)`. O `customerSchema.phone` em
`src/lib/validations/scheduling.ts` hoje só remove separadores
(`replace(/[\s()\-.]/g, "")`) e valida com `E164_REGEX = /^\+?[1-9]\d{7,14}$/`, que **aceita** um
nacional de 11 dígitos sem DDI (`47992391751`) e grava **sem** o `55`. É a origem do bug no lado
do cadastro (análise-data §1, análise-frontend "Ponto único de mudança").

O `customerSchema` é a fonte de validação **tanto do create quanto do edit** — `CustomerFormDialog`
reusa o mesmo schema, e `useCreateCustomer`/`useUpdateCustomer` gravam `values.phone`. Corrigir o
schema cobre cadastro **e** edição num único ponto (análise-frontend §4). Não há tela, rota, guard
ou componente novo.

A regra de normalização **não pode divergir** da borda do servidor (ADR-01). Pela decisão de
mecanismo de compartilhamento tomada na ADR-01 (duas implementações, mesma especificação fixada
por tabela de casos idêntica — runtimes Vite/TS vs Deno distintos), esta ADR implementa a regra no
lado do cliente e **espelha exatamente** a tabela canônica da ADR-01.

## Decisão

1. **Helper E.164-BR no cliente** em `src/lib/phone.ts` (arquivo que já concentra utilitários de
   telefone): adicionar `toE164BR(input: string): string | null` — puro, determinístico, sem
   rede. Aplica a especificação canônica da ADR-01:
   - limpa não-dígitos;
   - 10/11 díg sem DDI inicial `55` → prefixa `55`;
   - 12/13 díg começando com `55` → mantém;
   - fronteira por **comprimento** (10/11 = nacional; 12/13 = com DDI), igual à ADR-01, inclusive
     o caso DDD 55;
   - comprimento inválido (< 10 após limpar / > 13) → retorna `null` (sinaliza inválido para o
     schema rejeitar). **Diferença da borda:** aqui inválido é rejeitado (RF-E164-03); na borda
     (ADR-01) é defesa que não lança.
   - saída bem-sucedida em forma **E.164 canônica com `+`** (`+55...`), coerente com
     `formatPhoneForDisplay` (que faz `replace(/\D/g, "")` e espera `55`+DDD+assinante) e com os
     exemplos de aceite do PRD (`+5547992391751`).
   Documentar no JSDoc do helper a mesma tabela de casos da ADR-01, nomeando a ADR-01 como a dona
   da especificação.

2. **`customerSchema.phone`** em `src/lib/validations/scheduling.ts`: trocar o `transform`+`refine`
   atual por: `transform((v) => toE164BR(v))` seguido de `refine((v) => v !== null, { message })`
   e, por tipagem estrita, garantir que o valor final inferido seja `string` (ex.: refinar e então
   `transform` para `string`, ou usar o padrão do projeto para estreitar `string | null` → `string`
   após o refine). `CustomerInput` (`z.infer`) deve continuar com `phone: string`, sem `any`
   (RNF-E164-03). O `E164_REGEX` existente pode ser reaproveitado como checagem final de sanidade
   do formato dentro do helper ou do schema, mas **não substitui** a regra de DDI.

3. **Mensagem de erro pt-BR** (RF-E164-03 / AC-05): ajustar para não expor jargão técnico,
   refletindo que basta DDD + número — sugestão da análise-frontend §2:
   `"Informe um telefone com DDD (ex.: (11) 99999-8888)."`. Mantém pt-BR, associada ao campo via
   `FormMessage` (foco acessível, erro não comunicado só por cor — já garantido pelo shadcn/ui).

4. **Copy/UX opcional não bloqueante** em `CustomerFormDialog.tsx` (decisão: **incluir nesta mesma
   ADR**, pois é o mesmo arquivo/fluxo e a análise a recomenda): evoluir a `FormDescription` do
   campo telefone para explicitar o DDI assumido sem expor "E.164", ex.:
   `"Com DDD. Assumimos o Brasil (+55) automaticamente. É o número que recebe as mensagens de WhatsApp."`
   Placeholder `(11) 99999-8888` mantido. Nenhum token visual, nenhuma marcação de acessibilidade
   nova.

Nada mais da UI muda: `ClientesPage`, `formatPhoneForDisplay`, hooks TanStack Query, RBAC
(`canManageCustomers`), guards de auth/status e o fato de as mutações **não** enviarem `tenant_id`
(RLS deriva do JWT) permanecem intactos (RNF-E164-02).

## Consequências

- **Positivas:** novos cadastros e edições nascem em E.164 com DDI (`+5547992391751`);
  `formatPhoneForDisplay` passa a renderizar `+55 (47) 99239-1751` automaticamente; a dívida de
  legados fica finita e decrescente. Regra idêntica à borda, sem divergência.
- **Negativas / riscos:** duas implementações da mesma regra (cliente e servidor) — risco de
  divergência mitigado pela tabela de casos compartilhada da ADR-01 e pelos ACs espelhados. Editar
  um cliente legado passa a reescrever o telefone normalizado (comportamento desejado, item 3 do
  aceite visual).
- **Reversível:** mudança localizada no schema + um helper puro; reverter é restaurar o
  `transform`/`refine` anterior e remover `toE164BR`.

## Escopo

**frontend** (consome a especificação de dados definida na ADR-01).

## Arquivos afetados

- `src/lib/phone.ts` — novo helper puro `toE164BR` (+ JSDoc com a tabela de casos da ADR-01).
- `src/lib/validations/scheduling.ts` — `customerSchema.phone` usa `toE164BR`; mensagem pt-BR.
- `src/app/clientes/CustomerFormDialog.tsx` — copy da `FormDescription`/erro (opcional, não
  bloqueante).

Sem migration, sem RLS, sem rota/guard/componente novo. O CHECK de `customers.phone` permanece
intacto (AC-08).

## Critérios de aceite testáveis (desta ADR)

- **AC-02-a:** `toE164BR("(47) 99239-1751")` e `toE164BR("47992391751")` → `"+5547992391751"`
  (cadastro normaliza — AC-02 do PRD).
- **AC-02-b:** `toE164BR("+55 47 99239-1751")` / `toE164BR("5547992391751")` → `"+5547992391751"`
  (mantém DDI sem duplicar — AC-03).
- **AC-02-c (idempotência):** `toE164BR(toE164BR("47992391751")!)` → `"+5547992391751"` (AC-04).
- **AC-02-d (rejeição):** `toE164BR("123")` → `null`; e o `customerSchema` rejeita o submit com a
  mensagem pt-BR abaixo do campo (AC-05).
- **AC-02-e (fixo 10 díg):** `toE164BR("(11) 3322-4455")` → `"+551133224455"`.
- **AC-02-f (paridade com ADR-01):** para toda entrada da tabela de casos da ADR-01, `toE164BR`
  (removido o `+`) produz os mesmos dígitos que `normalizePhoneForEvolution` — não divergem
  (RF-E164-05).
- **Verificação:** `npm run build` (`tsc -b && vite build`) passa limpo — typecheck estrito sem
  `any` e bundle gerado (AC-09 lado frontend). `CustomerInput.phone` continua `string`. A prova
  visual (cadastrar sem DDI grava com DDI; exibição `+55 (47)...`; edição normaliza; inválido
  bloqueia) é a QA do run (PRD §8, itens 1–4), consolidada na ADR-04.

## Dependência

**Depende da ADR-01**, que define a especificação canônica E.164-BR (tabela de casos) e o
tratamento de inválidos. A ADR-02 espelha essa tabela no cliente; não reimplementa a regra de
forma independente.
