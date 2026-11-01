# ADR-04 — Campo "Ramo da empresa" obrigatório no cadastro — Revisão Independente B

**Revisor independente B** (modelo distinto do revisor A, análise cega ao parecer A).
Escopo revisado: diff `a8be1cf..f61ee33` (base = ADR-03), ou seja, os commits
`4701ff5` (`feat: campo obrigatório de ramo no cadastro (ADR-04)`) e `f61ee33`
(`fix: manter Select de ramo controlado desde o primeiro render no cadastro`).
Arquivos tocados: `src/lib/validations/auth.ts`, `src/auth/CadastroPage.tsx`,
`src/hooks/useAuthMutations.ts`, `src/lib/validations/auth.test.ts` (novo).

Esta ADR adiciona a seleção obrigatória de ramo (barbearia / clínica / salão) no
cadastro, validada por zod e enviada como metadado de signup em
`options.data.segment` — a chave que o `handle_new_user()` (ADR-02) lê de
`raw_user_meta_data->>'segment'`. A integração ao fluxo react-hook-form + `SignupInput`
está correta, o payload nunca carrega `role`/`tenant_id`, e nenhuma fronteira
multi-tenant/RLS/RBAC é tocada. O problema está no commit de correção `f61ee33`: a
sentinela `""` escolhida para silenciar o warning controlled/uncontrolled do React faz
o caminho de submissão real ("submeter sem escolher") cair num erro **em inglês**, não
na mensagem pt-BR que a própria ADR (AC-04.2) exige — e a suíte de testes não pega isso
porque só exercita o caso `undefined`.

**Watch for:**
- **(confirmed)** Mensagem de erro em inglês no caminho real de submissão sem escolha.
  Com `defaultValues.segment = "" as BusinessSegment`, submeter sem escolher valida o
  literal `""`, que o `z.enum` trata como `invalid_enum_value` e devolve
  `"Invalid enum value. Expected 'barbearia' | 'clinica' | 'salao', received ''"`. O
  `required_error`/`invalid_type_error` pt-BR só dispara para `undefined` (código
  `invalid_type`). Verificado empiricamente com zod 3.23.8 (ver Details). Viola AC-04.2
  e a convenção de produto "erros de usuário em pt-BR".
- **(confirmed)** O teste AC-04.2 não cobre o caminho real. `auth.test.ts` valida
  `signupSchema.safeParse(baseInput)` **sem** a chave `segment` (ou seja, `undefined`),
  que acerta a mensagem pt-BR — mas o `CadastroPage` nunca submete `undefined`: submete
  `""`. A suíte fica verde enquanto a UI exibe a mensagem errada. Falta um caso cobrindo
  `segment: ""`.

**Verdict**: NEEDS_CHANGES

## High-level view

O schema, o componente e a mutation estão corretos em estrutura: `segment` entra como
`z.enum(BUSINESS_SEGMENTS)` importado de `@/types/domain`, `SignupInput` tipa sem `any`,
o `FormField` usa o `Select` do shadcn/ui (Radix, já no projeto) com três itens fixos
entre "Nome da empresa" e "E-mail", e o `useSignUp` repassa `segment` junto de
`trade_name` em `options.data` — a chave-contrato que o servidor lê. Reuso de componente
coerente, zero token visual novo, zero rota/guard novo.

O defeito é de contrato de mensagem, introduzido pelo commit de fix. A ADR-04 original
especificava `defaultValues.segment` **sem valor inicial** (`undefined`), caso em que o
`required_error` pt-BR dispara corretamente. O `f61ee33` trocou por `"" as BusinessSegment`
para manter o Select controlado desde o primeiro render — mas, diferente do padrão de
`AppointmentFormDialog` que ele cita (lá os campos são `z.string().uuid("Selecione…")`, e
`""` falha o `.uuid()` com mensagem pt-BR), aqui o campo é `z.enum`, e `""` cai no ramo
`invalid_enum_value`, cuja mensagem padrão é em inglês e vaza os literais do enum para o
usuário final. O padrão citado não transfere porque o tipo de validação é outro.

A fronteira de segurança está intacta: `segment` é entrada não confiável validada no
cliente (UX) e no banco (`check`, autoridade); o cliente não envia `role` nem `tenant_id`;
nenhuma tabela de domínio é tocada (a coluna já existe desde ADR-01) e o isolamento segue
100% no RLS. Build, typecheck e os 53 testes passam. O achado é pequeno em diff mas
bloqueia porque quebra um critério de aceite explícito num texto voltado ao usuário.

<details>
<summary>Issues (3)</summary>

1. **Mensagem de erro em inglês ao submeter sem escolher ramo (confirmed, bloqueante)** —
   `defaultValues.segment = "" as BusinessSegment` faz o `z.enum` retornar
   `invalid_enum_value` com mensagem padrão em inglês, não a pt-BR exigida por AC-04.2.
   Corrigir fazendo o schema aceitar `""` como "não escolhido" com mensagem pt-BR — p.ex.
   `z.enum(BUSINESS_SEGMENTS, {...}).or(z.literal("")).refine(v => v !== "", "Escolha o ramo da sua empresa.")`,
   ou um `z.preprocess` que converte `""`→`undefined` antes do `z.enum`, ou um
   `errorMap` no enum que mapeie `invalid_enum_value` para a mensagem pt-BR. Escolher a
   forma que preserve `SignupInput.segment` tipado como `BusinessSegment` (sem `""`) no
   ramo de sucesso.
2. **Teste AC-04.2 não cobre o caminho real de submissão (confirmed)** — `auth.test.ts`
   só testa `segment` ausente (`undefined`); adicionar um caso `safeParse({ ...baseInput, segment: "" })`
   afirmando `result.success === false` **e** `issue.message === "Escolha o ramo da sua empresa."`.
   Esse teste deve falhar hoje e passar depois da correção do item 1 — é a prova de regressão.
3. **Comentário da sentinela afirma um comportamento que não ocorre (confirmed, menor)** —
   o comentário em `CadastroPage` diz "o enum zod não aceita '' e a submissão sem escolha
   dispara o erro pt-BR"; a segunda parte é falsa hoje (dispara o erro em inglês). Atualizar
   o comentário junto da correção para não documentar um contrato inexistente.

</details>

<details>
<summary>Details</summary>

### A sentinela `""` versus `z.enum`: a mensagem pt-BR não dispara no caminho real

O `signupSchema` define:

```ts
segment: z.enum(BUSINESS_SEGMENTS, {
  required_error: "Escolha o ramo da sua empresa.",
  invalid_type_error: "Escolha o ramo da sua empresa.",
}),
```

e o `CadastroPage` inicializa `defaultValues.segment = "" as BusinessSegment`. O
`Select` só chama `onValueChange` quando o usuário escolhe um item; até lá, o valor no
RHF é `""`. Logo, o caminho **real** de "submeter sem escolher" valida o literal `""`,
não `undefined`.

Em zod 3.23.8 (versão do `package.json`), `required_error` e `invalid_type_error` do
`z.enum` só cobrem o caso em que o valor **falta** (`undefined`), que produz o código
`invalid_type`. Um valor presente mas fora do conjunto — `""` ou `"outro"` — produz
`invalid_enum_value`, com a mensagem padrão em inglês. Verificado empiricamente:

```
undefined     => "Escolha o ramo da sua empresa."                                    [invalid_type]
""            => "Invalid enum value. Expected 'barbearia' | 'clinica' | 'salao', received ''"  [invalid_enum_value]
"outro"       => "Invalid enum value. Expected 'barbearia' | 'clinica' | 'salao', received 'outro'" [invalid_enum_value]
"barbearia"   => OK
```

Resultado observável na UI: um usuário que clica "Criar conta" sem escolher o ramo vê a
`FormMessage` em inglês, vazando os literais internos do enum. Isso viola AC-04.2
("exibe 'Escolha o ramo da sua empresa.'") e a convenção de produto de erros em pt-BR.
O revisor A aprovou citando que "submeter sem escolher ramo falha no resolver zod, exibe
o erro pt-BR" — isso vale para `undefined` (o estado que a ADR *original* especificava),
mas não para o `""` que o commit de fix `f61ee33` passou a usar; a aprovação não
considerou a mudança de `undefined`→`""`.

### Por que o padrão de `AppointmentFormDialog` não transfere

O comentário no `CadastroPage` justifica a sentinela como "mesmo padrão dos Selects de
`AppointmentFormDialog`". Mas lá os campos são `z.string().uuid("Selecione um cliente.")`
/ `.uuid("Selecione um profissional.")` / `.uuid("Selecione um serviço.")`
(`src/lib/validations/scheduling.ts:58-60`): a sentinela `""` falha o `.uuid()` e a
mensagem custom pt-BR dispara corretamente, porque `z.string().uuid()` aplica a mensagem
dada a **qualquer** falha de formato, inclusive string vazia. Já `z.enum` separa
"ausente" (`invalid_type`, cobre `required_error`) de "fora do conjunto"
(`invalid_enum_value`, mensagem padrão). O padrão foi copiado sem notar que a semântica
de erro do `z.enum` é diferente da do `z.string().uuid()` — por isso a mensagem pt-BR
que funciona no agendamento não funciona aqui.

### Opções de correção (qualquer uma resolve; preservar o tipo de sucesso)

- **`errorMap` no enum** mapeando `invalid_enum_value` (e `invalid_type`) para
  `"Escolha o ramo da sua empresa."`. Menor mudança; mantém `segment: BusinessSegment`.
- **`z.preprocess`** convertendo `""`→`undefined` antes do `z.enum`, de modo que o caso
  vazio caia no `required_error` já existente.
- **Voltar `defaultValues.segment` para `undefined`** e resolver o warning
  controlled/uncontrolled na borda do componente (o `value={field.value || undefined}`
  já está lá; com `defaultValue` undefined o `Select` do Radix aceita `value` undefined
  sem warning se o controle não oscilar — validar no QA ao vivo). Esta é a forma mais
  próxima da ADR original, mas exige confirmar que o warning do fix `f61ee33` não volta.

Em qualquer rota, adicionar o teste do item 2 para travar a regressão.

### O que está correto (não repetir trabalho)

- **Contrato de chave cliente↔servidor:** `options.data: { trade_name: tradeName, segment }`
  bate com `raw_user_meta_data->>'segment'` lido pelo `handle_new_user` (ADR-02). O
  comentário do `useSignUp` documenta isso com honestidade.
- **Tipagem sem `any`:** `z.infer<typeof signupSchema>` propaga `segment:
  'barbearia'|'clinica'|'salao'`; `BusinessSegment` importado de `@/types/domain`
  (fonte única, ADR-03). `tsc -b` verde.
- **Enum fechado:** três `SelectItem` fixos, sem "Outro", sem opção vazia selecionável —
  conforme a decisão (a) do PRD e o design doc (§2.2).
- **Fronteira de segurança:** `segment` é meta de signup (entrada não confiável),
  validado no cliente e no `check` do banco (defesa em profundidade); o payload **não**
  contém `role` nem `tenant_id` (teste AC-04.3 confirma o shape). Nenhuma tabela de
  domínio tocada; a coluna `segment` já existe em `tenants` (ADR-01); RLS não é alterado.
- **Acessibilidade:** `FormLabel` associado via `ui/form.tsx`; `SelectTrigger` (Radix)
  navega por teclado com foco visível reusando o anel do design system; `FormMessage`
  como `aria-describedby`. Sem token visual novo. (A verificação final de teclado/foco
  fica para o QA ao vivo — AC-04.5.)

### Contraprova executada

- `npm run build` (`tsc -b && vite build`): **verde**. Aviso pré-existente de chunk
  > 500 kB (não relacionado a esta ADR).
- `npm run typecheck` (`tsc -b`): **verde**, sem `any`.
- `npm run test` (`vitest run`): **53/53 passando** (6 suites; `auth.test.ts` novo com 6
  testes). Não há script de lint no `package.json`.
- Teste empírico de mensagem do `z.enum` com zod 3.23.8: ver tabela acima — a falha
  pt-BR só ocorre para `undefined`, não para `""`.

Os testes verdes **não** contradizem o achado: eles passam justamente porque não
exercitam o literal `""` que a UI submete. Build/typecheck não captura mensagem de erro
em runtime.

### Escopo versus ADR

A ADR pediu edição de `validations/auth.ts`, `CadastroPage.tsx` e `useAuthMutations.ts`
— os três presentes. O arquivo novo `auth.test.ts` é correlato (testa o schema) e
bem-vindo. Nenhuma mudança fora de escopo (sem guard, rota, migration ou hook de dados).
O desvio da ADR é o `defaultValues` `""` em vez do `undefined` especificado — e é
exatamente esse desvio que introduz o defeito.

</details>

<details>
<summary>Mapa de arquivos</summary>

- `src/lib/validations/auth.ts` — adiciona `segment: z.enum(BUSINESS_SEGMENTS, {...})` ao
  `signupSchema`; importa `BUSINESS_SEGMENTS` de `@/types/domain`. **Correto em estrutura;
  mensagem pt-BR não cobre o caso `""` — ver Issue 1.**
- `src/auth/CadastroPage.tsx` — novo `FormField` com `Select` de ramo entre "Nome da
  empresa" e "E-mail"; `SEGMENT_LABELS` inline; `defaultValues.segment = "" as
  BusinessSegment` (sentinela introduzida por `f61ee33`, causa do defeito); comentário
  afirma comportamento pt-BR que não ocorre — ver Issue 3.
- `src/hooks/useAuthMutations.ts` — desestrutura `segment` de `SignupInput` e o inclui em
  `options.data`. **Correto.**
- `src/lib/validations/auth.test.ts` — **novo**; 6 testes cobrindo AC-04.2 (só caso
  `undefined`/`"outro"`) e AC-04.3 (payload sem role/tenant_id). **Falta o caso `""` — ver
  Issue 2.**

Diff completo: `git diff a8be1cf..f61ee33 -- src`.

</details>
