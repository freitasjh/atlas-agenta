# Parecer do Revisor B — ADR-02 (Normalização E.164-BR no cadastro/edição de cliente)

**Data:** 2026-10-19 22:59
**Revisor:** B (independente, modelo distinto do revisor A — não vi o parecer de A)
**Commit revisado:** `1dab319` (`fix: normaliza telefone do cadastro para E.164-BR com DDI 55`)
**Escopo da ADR:** frontend — `src/lib/phone.ts`, `src/lib/validations/scheduling.ts`, `src/app/clientes/CustomerFormDialog.tsx`

## Veredito

**APROVADO.** A implementação adere à ADR-02, espelha com exatidão a especificação canônica da ADR-01 para todas as entradas válidas, mantém as fronteiras multi-tenant/RLS/RBAC/segredos intactas e o `npm run build` (`tsc -b && vite build`) passa limpo. Nenhuma issue bloqueante. Há duas observações não-bloqueantes abaixo.

---

## O que foi revisado e como

Revisão da ADR corrente (adr-02, `pending`) do bugfix A+B de telefone. Li a ADR-01 (dona da especificação), a ADR-02 (ponta do cadastro), as análises data/frontend e o diff do commit `1dab319`. Executei a contraprova de build e uma prova de paridade determinística entre as duas implementações da regra (cliente `toE164BR` vs servidor `applyBrDdi`/`normalizePhoneForEvolution`). Não subi dev server — a verificação visual via Chrome DevTools é do QA (step seguinte), conforme instruído.

## Aderência à ADR

O commit toca **exatamente** os três arquivos declarados em "Arquivos afetados", sem vazar para fora do escopo (`git show --stat` confirma 3 arquivos, 63 inserções / 13 remoções). Cada item da decisão foi cumprido:

- **Item 1 — helper `toE164BR` em `src/lib/phone.ts`:** criado puro e determinístico (sem rede/relógio/segredo), com JSDoc reproduzindo a tabela de casos da ADR-01 e nomeando a ADR-01 como dona da regra. Saída em E.164 canônico com `+` (`+55...`), inválido → `null`. Correto.
- **Item 2 — `customerSchema.phone`:** `transform((v) => toE164BR(v))` seguido de `refine((v): v is string => v !== null, …)`. O type guard estreita o inferido de `string | null` para `string`, mantendo `CustomerInput.phone: string` sem `any` (RNF-E164-03). O build estrito confirma. O `E164_REGEX` antigo foi removido — aceitável, pois a regra de DDI por comprimento o substitui com segurança (ver observação 1).
- **Item 3 — mensagem de erro pt-BR:** `"Informe um telefone com DDD (ex.: (11) 99999-8888)."` — sem jargão técnico, associada ao campo via `FormMessage` (acessibilidade do shadcn/ui preservada).
- **Item 4 — copy da `FormDescription`:** atualizada para explicitar o DDI assumido sem expor "E.164". Placeholder `(11) 99999-8888` mantido, nenhum token/marcação de acessibilidade novo.

## Paridade com a ADR-01 (RF-E164-05 / AC-02-f) — o ponto de contrato mais crítico

Executei ambas as implementações sobre a tabela canônica e os casos de borda. Para **toda entrada válida**, o cliente (removido o `+`) produz **os mesmos dígitos** que o servidor:

| Entrada | Cliente | Servidor | Paridade |
|---|---|---|---|
| `47992391751` (legado móvel 11) | `+5547992391751` | `5547992391751` | OK |
| `+55 47 99239-1751` / `5547992391751` | `+5547992391751` | `5547992391751` | OK |
| `1133224455` / `(11) 3322-4455` (fixo 10) | `+551133224455` | `551133224455` | OK |
| `551133224455` (12 díg com DDI) | `+551133224455` | `551133224455` | OK |
| `55999887766` (DDD 55 móvel 11) | `+5555999887766` | `5555999887766` | OK |

Os ACs AC-02-a a AC-02-e conferem. A idempotência (AC-02-c) também: `toE164BR(toE164BR("47992391751")!)` → `+5547992391751` (a 2ª aplicação cai em 13 díg começando com `55`). O caso de desambiguação DDD 55 (fronteira por comprimento, não por prefixo) está idêntico nos dois lados.

Para entradas **inválidas** (comprimento < 10 ou > 13, ou 12/13 díg sem `55`), o cliente devolve `null` (rejeita o submit) e o servidor devolve os dígitos como estão (defesa que não lança). **Isto é divergência de ação intencional e documentada** — "mesma regra de reconhecimento, ação distinta" (ADR-01 §tratamento de inválido; ADR-02 item 1). Não é defeito: na borda, quem recusa inválido é a Evolution; no cadastro, o RF-E164-03 exige rejeição. Confere com AC-02-d (`toE164BR("123")` → `null`).

Confiança: **confirmed** — tracei as duas funções lendo o código-fonte e executei a tabela.

## Fronteiras de segurança (multi-tenant / RLS / RBAC / segredos / LGPD)

- **RLS / tenant_id (RNF-E164-02):** `useCreateCustomer`/`useUpdateCustomer` continuam gravando **sem** enviar `tenant_id` — o isolamento deriva do JWT no banco. O commit não toca esses hooks. Fronteira intacta (**confirmed**).
- **RBAC:** `canManageCustomers`, guards de auth/status e o fato de a UI não ter rota/guard novo permanecem inalterados — nenhum arquivo de permissão/guard no diff (**confirmed**).
- **Segredos:** o helper é puro no bundle do cliente; não há chave Asaas/Evolution/service role envolvida. Nenhuma `anon key`/segredo adicionado (**confirmed**).
- **LGPD / PII:** `toE164BR` não loga o número; nenhuma linha de log nova com telefone. A copy de UX não expõe dado sensível (**confirmed**).

## Design doc React / convenções de código

Formulário segue o padrão do projeto (react-hook-form + `zodResolver`, `FormDescription`/`FormMessage` do shadcn/ui, mobile-first intacto). TypeScript estrito sem `any`; validação de entrada por zod; mensagem de usuário em pt-BR, JSDoc técnico aceitável. O helper fica em `src/lib/phone.ts`, o módulo que já concentra utilitários de telefone — sem recriar componente. Coerente com `frontend-design`/`ui-frontend`.

## Contraprova de build

`npm run build` → `tsc -b && vite build` concluiu **sem erros** (`✓ built in 6.56s`). Não há script de lint/test no `package.json` (`dev`, `build`, `typecheck`, `preview` apenas), então o typecheck estrito do build é a verificação de qualidade disponível, e passa. O warning de chunk > 500 kB é pré-existente e global ao bundle, não introduzido por esta ADR.

## Observações não-bloqueantes

1. **Remoção do `E164_REGEX` como sanidade final (possible):** a ADR-02 item 2 dizia que o `E164_REGEX` "pode ser reaproveitado como checagem final de sanidade". O implementador optou por removê-lo e confiar só na regra de comprimento 10–13. Na prática a regra de comprimento já cobre o espaço BR válido, então não há perda real de validação para o escopo do produto (Brasil). É uma escolha dentro da margem que a ADR permitia ("pode", não "deve"). Sem ação necessária; registro para transparência.

2. **Colisão de nome `CustomerInput` (possible, pré-existente, fora de escopo):** há dois tipos `CustomerInput` — o `z.infer` em `src/lib/validations/scheduling.ts` (usado pelo form) e uma `interface` em `src/hooks/useCustomers.ts` (com `active`). Não foi introduzida por este commit e não afeta o typecheck. Não cabe corrigir nesta ADR; anoto para não ser confundida em revisões futuras.

## Conclusão

A ADR-02 está **aprovada**. A regra de normalização do cadastro espelha fielmente a especificação da ADR-01, o contrato de não-divergência (RF-E164-05) é respeitado para toda entrada válida, as fronteiras de isolamento e segredos permanecem intactas e o build passa limpo. A prova visual ponta-a-ponta (cadastrar sem DDI grava com DDI; exibição `+55 (47)…`; edição normaliza; inválido bloqueia) fica para o QA do run, como a própria ADR define.
