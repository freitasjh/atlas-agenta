# Review A — ADR-19: Frontend Polling + Check + QR Persistente

**Revisor:** Revisor A (independente)  
**ADR:** adr-19-frontend-polling-check-qr-persistente.md  
**Status:** ✅ **APPROVED**

---

## Summary

A ADR-19 implementa o lado frontend da reconciliação de estado WhatsApp: integra a ação `check` (definida em ADR-17 e implementada no backend em ADR-18) no polling existente de `useWhatsAppInstance`, e preserva o QR na tela enquanto `aguardando_qr`. A mudança é cirúrgica — toca apenas três arquivos — e adere completamente às fronteiras de segurança (sem `tenant_id` no cliente, validação de dados com zod, falhas best-effort). O build e typecheck passam limpos. Nenhuma dependência nova é adicionada; zero regressão em A11y/mobile-first/dark-mode.

**Verdict**: APPROVED

---

## High-level view

O backend (ADR-18) agora expõe uma ação `check` que consulta o estado real da Evolution e atualiza `whatsapp_instances.connection_status = "conectado"` quando `state === "open"`. O frontend precisa disparar essa ação periodicamente enquanto está `aguardando_qr` para que a transição para `conectado` seja observável sem reload. A decisão implementada (abordagem A da análise) **funde a reconciliação no `queryFn` existente** do `useWhatsAppInstance`: aproveitando o `refetchInterval` condicional já existente (2500 ms enquanto `aguardando_qr`, desligado nos estados estáveis), o `queryFn` agora executa `reconcileWhatsAppCheck()` antes de reler a linha. Assim, um único ciclo de polling cuida de "reconciliar + ler", sem segundo timer e sem complexidade de coordenação entre efeitos.

O `ConnectionCard` recebe um comentário defensivo para garantir que o `useState` local do QR não seja zerado durante os refetches — o QR persiste enquanto a linha estiver `aguardando_qr`, e só desaparece quando a linha passar para `conectado` (ramo renderizado muda).

O contrato de fio (DTOs) é espelhado corretamente em `whatsapp.ts`: `CheckRequest` e `CheckResponse`, documentados como espelho explícito de `schemas.ts` no backend. Toda resposta é validada por zod local antes do uso (dado não confiável), no padrão já estabelecido por `pairResponseSchema`.

---

<details>
<summary>Issues (0)</summary>

✅ Nenhum problema bloqueante identificado.

</details>

---

<details>
<summary>Details</summary>

### Arquitetura TanStack Query: Polling condicional refundido

O `queryFn` de `useWhatsAppInstance` agora segue a sequência:

1. `readWhatsAppInstanceRow()` — lê a linha sob RLS (dado canônico).
2. Se `connection_status !== "aguardando_qr"`, retorna a linha como estava.
3. Se `connection_status === "aguardando_qr"`, invoca `reconcileWhatsAppCheck()` (best-effort) e relê a linha.

Essa decisão de **ordem** (ler primeiro, depois checar se precisa reconciliar) é a mais robusta: captura o estado atual e só processa a reconciliação quando relevante. A alternativa de "checar sem ter lido" não funcionaria aqui (sem contexto do que está `aguardando_qr`).

O `refetchInterval` condicional permanece intacto e já funciona perfeitamente — liga/desliga conforme o estado. Nenhum segundo timer, nenhuma coordenação entre efeitos.

**Confirmado:** ✓ sem `fetch` solto em `useEffect` — tudo passa por TanStack Query.

### Best-effort reconciliação: Engulindo falhas com segurança

`reconcileWhatsAppCheck()` invoca a Edge Function, valida a resposta com zod, e **engole qualquer erro dentro de `try/catch`**. O log de erro é `console.debug` — apropriado para best-effort transitório (não é um erro do usuário, é ruído de rede/infra).

Falha de `check` **nunca** derruba:
- A leitura da linha (dado canônico segue seu caminho).
- O QR na tela (o `useState` não é tocado por essa função).
- A experiência do usuário (sem toast de erro a cada tick).

Quando a Evolution fica fora, o polling **mantém o QR visível e continua tentando** — comportamento correto de resiliência (RF-QR-06).

**Confirmado:** ✓ tratamento de erro defensivo, nenhum vazamento de PII ou segredos em logs.

### DTOs e validação: Espelho de contrato

`CheckRequest` e `CheckResponse` em `whatsapp.ts` espelham o contrato do servidor. A documentação **menciona explicitamente** "espelho do `checkResponseSchema` do backend" — critério de acompanhamento claro: se o backend mudar, atualizar aqui.

`checkResponseSchema` em `useWhatsAppInstance.ts` valida a resposta antes de usar — padrão zod já estabelecido por `pairResponseSchema`. Parse inválido é engolido (best-effort), não causa crash.

**Confirmado:** ✓ nenhum `tenant_id` no corpo de `check` (só `{ action: "check" }`). ✓ Validação de dado não confiável. ✓ Sem dependência nova (zod já estava no projeto).

### QR persistente: Comentário + Manutenção

`ConnectionCard` recebe um **comentário explicativo** (3 linhas) dizendo que o `useState` do QR é setado **só em `handleConnect`** e **nunca zerado** por efeito/refetch — enquanto a linha está `aguardando_qr`, o card reutiliza o QR armazenado localmente. Quando a linha vira `conectado`, o ramo renderizado muda e o QR deixa de ser exibido (correto).

Essa **não é uma mudança de código**, apenas uma documentação defensiva no lugar certo (próximo ao `useState`). Garante que futuros refatoradores não inadvertidamente injetem lógica que zere o QR.

**Confirmado:** ✓ QR persiste entre refetches enquanto `aguardando_qr`. ✓ QR desaparece naturalmente ao virar `conectado`. ✓ Sem efetos colaterais de polling.

### TypeScript estrito e build

- `npm run typecheck` (tsc -b): **✓ limpo, sem erro**
- `npm run build`: **✓ sucesso** (warning de chunk size é pré-existente, fora do escopo desta ADR)
- Nenhum `any` implícito adicionado
- Tipos bem-definidos: `CheckRequest`, `CheckResponse`, `WhatsAppInstance | null`

**Confirmado:** ✓ TS estrito, sem regressão.

### Conformidade com convenções

- **pt-BR:** sem mudança de texto de UI; comentários técnicos em inglês (padrão).
- **Mobile-first / Dark:** nenhuma mudança de estilo; dark mode preservado (a tela já tem suporte).
- **Acessibilidade:** nenhuma regressão; `aria-live="polite"` funciona corretamente com a transição assíncrona via polling (antes não funcionava porque o estado não transitava; agora funciona).
- **Segurança:** `anon key` no cliente; service role nunca no bundle; QR efêmero, nunca persistido.

**Confirmado:** ✓ aderência total às convenções do workspace.

### Dependência de ADR-17 e ADR-18

Esta ADR assume que:
- ADR-17 definiu a porta `EvolutionAdapter.getConnectionState` e o contrato `CheckResponse`.
- ADR-18 implementou `handleCheck` na Edge Function com a transição real `check → conectado`.

Ambas as ADRs estão approved (verificado em `index.json`). O frontend não precisa de nenhuma mudança no backend para funcionar — a ação `check` já existe e é invocável.

**Confirmado:** ✓ dependências satisfeitas. ✓ Integração pronta.

### Critério de aceite CA-19.1 (build e typecheck)

✓ `npm run build` conclui sem erro.  
✓ `npm run typecheck` passa limpo, TS estrito.  
✓ Nenhuma dependência nova em `package.json`.  
✓ Sem `any` implícito.

### Critérios de aceite visuais (CA-19.2 a CA-19.6)

Estes critérios requerem teste ao vivo (Chrome DevTools, modo real/mock, RBAC, error resilience, responsivo/dark). O código passa os pré-requisitos técnicos (build, types, estrutura); os critérios visuais/E2E são responsabilidade do QA da ADR e do modo MOCK do backend.

**Nota:** o código **habilita** esses testes — antes, o polling **nunca** chamava `check`, então o fluxo era inobservável. Agora é.

</details>

---

## File map

<details>
<summary>Mudanças por arquivo</summary>

- **src/lib/whatsapp.ts**: Adicionados tipos `CheckRequest` e `CheckResponse` espelhando o contrato do servidor (ADR-17).
- **src/hooks/useWhatsAppInstance.ts**: Refatorado `queryFn` para integrar `reconcileWhatsAppCheck()` (best-effort) enquanto `aguardando_qr`. Novos helpers `readWhatsAppInstanceRow()` e `reconcileWhatsAppCheck()` para clareza. Schema zod `checkResponseSchema` adicionado.
- **src/app/config/whatsapp/ConnectionCard.tsx**: Comentário defensivo adicionado ao `useState` do QR para documentar que não é zerado entre refetches.

**Diff completo:** [commit 7d6231a](git show 7d6231a)

</details>

---

## Conclusão

ADR-19 implementa com precisão a reconciliação assíncrona do estado WhatsApp via polling — sem reintroduzir a complexidade de efeitos, sem violar fronteiras de multi-tenant, sem sacrificar segurança ou acessibilidade. A decisão arquitetural (fundir no `queryFn` existente) é robusta e mantém a simplicidade do padrão TanStack Query.

**Status final:** ✅ **APROVADA** — pronta para merge e QA ao vivo.
