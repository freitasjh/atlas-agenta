# ADR-03 — Contrato de renderização compartilhado (`renderTemplate` + lista fechada + fallback)

**Status:** proposto

**Escopo:** frontend (util compartilhado; o servidor espelha a mesma tabela)

**Depende de:** nenhuma de dados — é uma peça pura, codificável e testável sozinha. Vem **antes** do
servidor (ADR-04) e das telas (ADR-06) porque ambos consomem este contrato. Reusa o enum
`MESSAGE_TEMPLATES` já em `src/types/domain.ts`.

## Contexto

O preview da UI (ADR-06) e a renderização canônica do servidor (ADR-04) **precisam produzir o mesmo
texto** dado o mesmo (template, dados) — senão o admin vê uma coisa no preview e o cliente recebe
outra. A decisão D4 do PRD trava a **mesma lista fechada e a mesma tabela de fallback** nos três
pontos (chip-bar do editor, `renderTemplate` do preview, render do servidor). Isolar o contrato numa
peça pura e determinística (RNF-T05) torna-o testável sem rede/relógio e evita divergência.

Atenção a uma divergência entre as análises nos **textos de fallback**: `analysis-frontend.md` §4.3
usa `{nome}→"você"`, `{dataHora}→"o horário combinado"`; `analysis-data.md` §6.3 e o PRD §RF-T07
(canônico) usam `{nome}→"cliente"`, `{dataHora}→"no horário combinado"`. **O PRD vence** (regra do
pipeline): a tabela abaixo segue o PRD. Também divergem no token desconhecido: o PRD §RF-T07 manda
**manter literal**; `analysis-frontend.md` sugeriu remover. **O PRD vence: token desconhecido é
mantido literal** (decisão consciente — só as 4 variáveis conhecidas têm fallback; nunca exibir erro
ao cliente).

## Decisão

Criar `src/lib/message-templates.ts` (novo), TS estrito, sem `any`, exportando:

1. **Lista fechada de variáveis** como const/tipo: `TEMPLATE_VARIABLES = ['nome','servico',
   'dataHora','empresa'] as const` e `type TemplateVariable`. **Não incluir `{valor}`** (D4 — fora
   da Fatia 1). Opcional: um array de metadados `{ token: '{nome}', label: 'Nome do cliente' }` para
   os chips do editor (ADR-06 consome).
2. **Tabela de fallback pt-BR** (fonte única, canônica do PRD §RF-T07):
   - `{nome}` → `cliente`
   - `{servico}` → `seu atendimento`
   - `{dataHora}` → `no horário combinado`
   - `{empresa}` → `trade_name` do tenant, ou `nossa equipe` se nulo
3. **`renderTemplate(body: string, vars: Partial<Record<TemplateVariable, string | null>>): string`**
   — função **pura e determinística**:
   - substitui cada `{var}` conhecida pelo valor fornecido quando presente e não vazio; quando o
     dado falta (ausente/`null`/vazio), usa o fallback da variável;
   - **token desconhecido** (ex.: `{foo}`) é mantido **literal** no texto;
   - nunca lança; nunca devolve um `{var}` conhecido cru.
   - `{empresa}`: o chamador passa `trade_name` (ou `null`); a função aplica `nossa equipe` quando
     nulo/vazio.

O servidor (ADR-04) **replica** esta mesma tabela e lógica em Deno (não pode importar
`@/`-aliases do app; a lógica é pequena e será espelhada — a ADR-04 cita este arquivo como a fonte
canônica e exige paridade). Registrar no texto da ADR-04 que qualquer mudança aqui obriga atualizar
lá.

Esta ADR é candidata a promoção para `docs/` como "contrato de variáveis de template"; **não copiar
agora**.

## Consequências

- Preview (cliente) e envio (servidor) compartilham a mesma semântica; divergência vira bug
  detectável por teste.
- A lista fechada é o único lugar onde `{valor}` entraria no futuro (evolução aditiva), sem quebrar.
- Adicionar uma variável nova = editar um ponto no cliente + espelhar no servidor (contrato
  explícito).

## Arquivos afetados

- `src/lib/message-templates.ts` (novo)
- `src/lib/message-templates.test.ts` (novo — unit, segue o padrão de `scheduling-slots.test.ts`)

## Critérios de aceite (testáveis nesta ADR)

- **RNF-T05 / AC-05 / AC-06 (unit):** `npm run test` (vitest) passa os testes de
  `message-templates.test.ts`, cobrindo:
  - substituição correta das 4 variáveis quando os dados existem;
  - fallback por variável faltante (ex.: `{nome}` sem dado → `cliente`; `{empresa}` nulo → `nossa
    equipe`), nunca o placeholder cru;
  - token desconhecido (`{foo}`) mantido literal;
  - determinismo: mesma entrada → mesma saída.
- **Typecheck:** `npm run typecheck` limpo; sem `any`; `TemplateVariable` é enum fechado.
- Verificar: `npm run test` e `npm run typecheck` com exit 0.
