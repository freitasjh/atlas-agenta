# Design de Frontend — Painel do Super Admin, Fatia 1 (Empresas + status de assinatura)

## Visão geral

Esta fatia troca o placeholder de `src/admin/pages.tsx` (`EmpresasPage`) por uma
tela de produto real: o super admin **vê** todas as empresas assinantes num só
lugar (lista cross-tenant com busca por nome e filtro por status) e **opera** a
assinatura de cada uma (mudar `subscription_status`: `trial | ativo | pendente |
bloqueado | cancelado`). É uma demanda de peso/segurança — cruza a fronteira
cross-tenant e mexe em privilégio de assinatura —, então a decisão de fronteira
de dados vem resolvida aqui e a UI é desenhada em cima dela, não ao contrário.

Decisão de fronteira (travada, ver §6 e a dependência de dados D1):

- **Leitura cross-tenant** acontece pelo cliente (anon key + sessão), apoiada na
  policy RLS `tenants_super_admin` (SELECT) que já existe no banco. O cliente
  **nunca** envia `tenant_id` para filtrar — o RLS é a trava: o super admin lê
  todas as linhas porque a policy o autoriza, o não-super-admin lê zero.
- **Escrita de `subscription_status`** acontece **exclusivamente** por uma Edge
  Function nova com service role (`admin-subscription`), que (a) confirma pelo
  JWT/profiles que o chamador é `super_admin`, (b) valida a transição, (c)
  persiste e (d) registra a operação em log de auditoria. O cliente **não tem**
  caminho de UPDATE de `subscription_status` — isso é dependência de dados do
  backend (D1/D2), não trabalho de frontend; aqui desenhamos o consumo.

A tela reusa integralmente a casca (`DashboardShell`/`AdminLayout`), os guards
(`RequireAuth` + `RequireRole`), os primitivos shadcn/ui de `src/components/ui`,
o `StatusBadge` (variante `subscriptionStatus`, já existente) e o padrão de hook
TanStack Query + zod + `supabase.functions.invoke` já consolidado em
`useWhatsAppInstance`. Nada de primitivo novo, nada de `fetch` solto.

Stack travada desta fatia: **React + Vite + TypeScript estrito**, **Tailwind +
shadcn/ui**, **React Router** (rotas já existem), **TanStack Query** para estado
de servidor, **react-hook-form + zod** para o formulário de mudança de status,
**sonner** (`src/components/ui/sonner`) para toast de resultado. Sem nenhuma
biblioteca nova.

---

## 1. Telas, componentes, rotas e guards

### 1.1 Rotas (já existem — sem mudança de roteamento)

O grupo `/admin` em `src/router.tsx` já está montado e guardado:

```
/admin            RequireAuth → RequireRole(["super_admin"]) → AdminLayout → AdminDashboardPage
/admin/empresas   (mesma cadeia) → EmpresasPage        ← esta fatia ganha conteúdo real
```

Nenhuma rota nova. `AdminSidebar` já tem o item "Empresas" apontando para
`/admin/empresas`. A fatia preenche **só** o conteúdo de `EmpresasPage`.

Guards (defesa em profundidade, a trava real é o RLS + a Edge Function):

- **Autenticação:** `RequireAuth` já redireciona sem sessão para `/login`.
- **RBAC:** `RequireRole(["super_admin"])` já renderiza `AccessDenied` para
  qualquer papel que não seja `super_admin`. Não recriar o guard; ele cobre a
  tela inteira. Um `admin`/`receptionist`/`professional` que force a URL
  `/admin/empresas` cai em `AccessDenied` antes de qualquer render de dados.
- **Status de assinatura:** o guard `RequireActiveSubscription` **não** se aplica
  a `/admin` (super_admin não tem tenant nem assinatura própria — já tratado em
  `useCurrentUser`/`RequireActiveSubscription`). A regra de "bloqueado redireciona
  para quitação" é do `/app`, não do `/admin`. Nesta fatia o super admin **opera**
  o status alheio; ele não é gated pelo próprio status.

### 1.2 Árvore de componentes da `EmpresasPage`

Todos novos moram em `src/admin/` (área do super admin), consumindo UI
compartilhada de `src/components`. Um componente por arquivo, PascalCase.

```
src/admin/
  pages.tsx                         (EmpresasPage passa a compor os blocos abaixo)
  empresas/
    EmpresasPage.tsx                orquestra: filtros + estado da query + tabela/empty/erro
    EmpresasFilters.tsx             busca por nome (Input) + filtro por status (Select)
    EmpresasTable.tsx               tabela (desktop) + lista de cards (mobile)
    EmpresaRow.tsx                  linha/card de uma empresa + ação "Mudar status"
    MudarStatusDialog.tsx           Dialog com form react-hook-form + zod da transição
```

> Nota de organização: extrair `EmpresasPage` para `src/admin/empresas/` e deixar
> `src/admin/pages.tsx` reexportando mantém o import atual do router
> (`import { EmpresasPage } from "@/admin/pages"`) estável. `AdminDashboardPage`
> continua placeholder (fora de escopo desta fatia).

### 1.3 Comportamento de cada tela/estado

**Lista (`EmpresasTable` + `EmpresaRow`)** — colunas/campos por empresa:

- **Empresa**: `trade_name` com fallback para `legal_name` (nome fantasia é o
  que o operador reconhece; razão social quando não há fantasia). Documento
  (`document`, CNPJ/CPF) aparece como linha secundária discreta — é dado de
  identificação, não PII sensível de cliente final.
- **Plano**: rótulo pt-BR de `plan` (`individual → Individual`, `clinica →
  Clínica/Equipe`, `pro → Pro`).
- **Status de assinatura**: `StatusBadge` variante `subscriptionStatus` (já
  mapeia os 5 estados com tokens de tema).
- **Fim do trial**: `trial_ends_at` formatado em pt-BR; quando `null`, exibir
  "—" (traço), nunca string vazia nem "null". Formatação de data: `Intl`
  pt-BR direto (data de calendário, sem conversão de fuso complexa — ver §1.5).
- **Ação**: botão/menu "Mudar status" que abre `MudarStatusDialog`.

**Filtros (`EmpresasFilters`)**:

- **Busca por nome**: `Input` controlado; filtra client-side por substring
  case-insensitive sobre `trade_name` **e** `legal_name`. Debounce de 250ms para
  não re-renderizar a cada tecla (volume esperado de tenants é baixo no MVP;
  filtro em memória é suficiente e evita waterfall de requests).
- **Filtro por status**: `Select` (shadcn) com opção "Todos" + os 5 status
  (rótulos pt-BR vindos da mesma fonte do `StatusBadge`). Filtra client-side.
- Busca e filtro **combinam** (AND). Ambos operam sobre o resultado único da
  query — não disparam novas requisições.

**Estados (pt-BR, obrigatórios):**

- **Carregando**: `Skeleton` (shadcn, já existe) em formato de linhas de tabela
  no desktop e de cards no mobile. Nada de spinner solto.
- **Vazio — sem empresas**: `StatePanel titulo="Nenhuma empresa ainda"
  descricao="As empresas assinantes aparecem aqui assim que o primeiro cadastro
  for criado."`. Esta fatia **não** cria empresa (INSERT revogado — ver §6), logo
  o empty não tem CTA de "criar".
- **Vazio — filtro sem resultado** (distinto do anterior): `StatePanel
  titulo="Nenhuma empresa encontrada" descricao="Ajuste a busca ou o filtro de
  status para ver outras empresas."`. Diferenciar os dois empties é intencional:
  "não há nada" ≠ "seu filtro escondeu tudo".
- **Erro de leitura**: `StatePanel titulo="Não foi possível carregar as empresas"
  descricao="Verifique a conexão e tente novamente."` + botão "Tentar novamente"
  (chama `refetch` da query). Sem vazar mensagem técnica do PostgREST.

**Mudança de status (`MudarStatusDialog`)**:

- `Dialog` (shadcn) disparado por linha. Título em pt-BR: "Alterar assinatura —
  {nome da empresa}".
- Form com **react-hook-form + resolver zod**: um `Select` com os status
  **destino permitidos** a partir do status atual (a lista de destinos vem da
  máquina de transições — ver §4.3; opções inválidas não aparecem) e um campo
  opcional de **motivo** (`Textarea`, até 280 chars, trim) que vai junto ao log
  de auditoria.
- Botão primário "Salvar alteração" com estado `pending` (desabilitado +
  rótulo "Salvando..."); botão secundário "Cancelar" fecha sem efeito.
- Em sucesso: fechar o dialog, `invalidateQueries` da lista (refetch reflete o
  novo badge) e `toast.success("Assinatura atualizada.")` (sonner).
- Em falha: manter o dialog aberto, mostrar o erro pt-BR mapeado (§4.4) acima
  dos botões (role `alert`), sem fechar — o operador reavalia.

### 1.5 Dinheiro e datas

- Não há dinheiro nesta fatia (tenants não tem `*_cents`).
- `trial_ends_at` é um instante `timestamptz`; para o super admin, exibir como
  **data no fuso do próprio tenant da empresa** seria o ideal, mas o fuso varia
  por linha. Decisão: exibir `trial_ends_at` como **data** (dia/mês/ano) via
  `Intl.DateTimeFormat("pt-BR", { dateStyle: "medium", timeZone:
  row.timezone ?? "America/Sao_Paulo" })`, usando o `timezone` da própria linha
  de tenant (que já vem no SELECT). Assim "fim do trial" é a data que faz sentido
  para aquela empresa, não para o fuso do browser do super admin. Reaproveitar
  `formatDateInTenantTz` de `src/lib/datetime.ts` se a assinatura casar; senão,
  `Intl` direto na borda de apresentação (sem lib nova).

---

## 2. Direção visual e design system

### 2.1 Princípio

O painel do super admin é **ferramenta de operação**, não vitrine. A direção
visual não é a da landing (que é persuasiva); aqui a personalidade é
**densidade legível e hierarquia de risco**. O operador varre dezenas de linhas
procurando o que está errado (inadimplente, trial vencendo) e age. A tela é
desenhada para que o status "ruim" salte e a ação seja de um clique — sem
floreio que atrapalhe a varredura. Isso é coerente com o resto do `/app` (mesma
casca, mesmos tokens), então a fatia **não introduz tokens novos**: reusa o
design system existente para não destoar do produto já construído.

### 2.2 Tokens (reuso, zero token novo)

- **Cor**: tokens semânticos do tema já existentes (`--background`,
  `--foreground`, `--card`, `--border`, `--muted`, `--muted-foreground`,
  `--primary`). Os **badges de status** usam os tokens de status dedicados
  (`--status-*`) via `StatusBadge` (já mapeado: `trial`, `ativo`, `pendente`,
  `bloqueado`, `cancelado`). Nunca `style` inline nem cor fora de token — garante
  dark mode correto.
- **Tipografia**: `font-display` (já no projeto) para os títulos de página/seção
  via `PageHeader`; corpo e dados na fonte base. Números/datas da tabela com
  `tabular-nums` para alinhar as colunas na varredura vertical.
- **Espaçamento/raio**: escala Tailwind padrão do projeto; cards/tabela com o
  mesmo `rounded-lg border border-border` das telas de `/app`. Mesma régua de
  `space-y-6` do `PageHeader` já usado no placeholder.

### 2.3 Badges de status (semântica de risco)

O `StatusBadge` já entrega o mapa de cor por status. A leitura de risco que a
tela reforça (sem mudar o componente):

- `ativo` → verde (confirmado): saudável.
- `trial` → âmbar/azul (em-atendimento): em avaliação, atenção ao vencimento.
- `pendente` → amarelo (pendente): requer acompanhamento.
- `bloqueado` → vermelho (cancelado): inadimplente, alvo de ação.
- `cancelado` → cinza (sub-cancelado): encerrado.

O "fim do trial" ganha um reforço discreto: quando `subscription_status ===
"trial"` e `trial_ends_at` já passou, a data aparece em `text-destructive`
(ou token de status) com `aria-label` "trial vencido" — ajuda a varredura sem
inventar uma coluna nova.

### 2.4 Layout responsivo (mobile-first)

- **Mobile (<768px)**: cada empresa é um **card** (não tabela com scroll
  horizontal): nome em destaque, badge de status, plano e fim do trial em pares
  rótulo/valor, botão "Mudar status" full-width no rodapé do card. Filtros
  empilhados (busca em cima, select de status embaixo), ambos full-width.
- **Desktop (≥768px)**: `Table` (shadcn) com as colunas de §1.3; filtros lado a
  lado acima da tabela; ação na última coluna (botão compacto ou ícone com
  rótulo acessível). O `md:` controla a troca card↔tabela.
- A casca `DashboardShell` já dá sidebar fixa ≥md e `Sheet` no mobile — nada a
  fazer no chrome.

### 2.5 Signature (o único toque além do utilitário)

Um **resumo de contagem por status** no topo da lista (ex.: "12 ativas · 3 em
trial · 2 bloqueadas"), derivado em memória do mesmo resultado da query. É a
coisa que o fundador quer saber de relance ao abrir o painel, e é barato (sem
request extra). **Não** é o painel de métricas consolidadas (fora de escopo §6):
é só a contagem dos status das linhas já carregadas, texto discreto abaixo do
`PageHeader`. Esse é o único elemento "a mais"; o resto é disciplina utilitária.

---

## 3. Acessibilidade (obrigatório)

- **Tabela**: markup semântico já vem do `Table` shadcn (`<th scope="col">`).
  Cada `<th>` com rótulo textual pt-BR. A versão mobile em cards usa pares
  rótulo/valor com `<dl>/<dt>/<dd>` ou rótulo visível — valor nunca fica sem
  rótulo associado.
- **Filtros**: `Input` de busca com `<label>` associado ("Buscar por nome") —
  visível ou `sr-only` com `aria-label`. `Select` de status com label
  "Filtrar por status". Foco visível (anel do tema) preservado — não sobrescrever
  o `focus-visible` dos primitivos shadcn.
- **Dialog**: `Dialog` shadcn já entrega `role="dialog"`, foco preso, `Esc`
  fecha e retorno de foco ao gatilho. Título do dialog é o `DialogTitle` (lido
  pelo leitor de tela). O `Select` de destino e o `Textarea` de motivo com
  `<label>` associado via `Form`/`FormLabel` (shadcn form).
- **Badges de status**: cor **não** é o único canal — o texto do status ("Ativo",
  "Bloqueado") está sempre no badge. O reforço de "trial vencido" tem
  `aria-label`, não só cor.
- **Teclado**: busca → select → cada linha → botão de ação, em ordem natural de
  tab. O botão "Mudar status" é um `<button>` real (não div clicável). "Tentar
  novamente" e os botões do dialog são alcançáveis e operáveis por Enter/Espaço.
- **Toast (sonner)**: mensagens de sucesso/erro anunciadas (o `Toaster` do
  projeto usa região live). Erro no dialog também fica em texto com `role="alert"`
  (não depender só do toast).
- **Contraste (WCAG AA, a confirmar no QA)**: todos os tokens de texto/badge já
  são os do design system do `/app`, desenhados para AA em claro e escuro. O par
  crítico a **verificar** no QA é o texto do badge sobre o fundo do badge em cada
  status, nos dois temas (alvo ≥ 4.5:1 para texto normal; badges usam texto
  pequeno, então 4.5:1). O QA por Chrome DevTools calcula o contraste real das
  combinações `bg-status-* / text-status-*-foreground`; marcar como critério
  verificável (§5), não afirmar conformidade aqui sem medição.

---

## 4. Arquitetura React (componentes vs hooks vs estado de servidor)

### 4.1 Estado de servidor — SEMPRE TanStack Query

Dois hooks novos em `src/hooks/`, espelhando o padrão de `useWhatsAppInstance`
(query + mutation + invalidação, toda resposta validada por zod):

**`useAdminTenants()` — leitura cross-tenant (query):**

```
queryKey: ["admin", "tenants"]
queryFn:
  supabase
    .from("tenants")
    .select("id, trade_name, legal_name, document, plan, subscription_status, trial_ends_at, timezone, created_at")
    .order("created_at", { ascending: false })
  → zod .parse() do array (shape adminTenantRowSchema)
```

- **Sem `.eq("tenant_id", ...)`**: o cliente **não** filtra por tenant. O RLS
  (`tenants_super_admin` SELECT) é quem decide o que volta. Para o super admin,
  volta tudo; para qualquer outro papel, volta zero linhas (e o guard de rota já
  barrou a tela antes disso). Isto é o ponto de segurança central: **o isolamento
  é do banco**, a UI não "pede tudo com um tenant_id" nem contorna RLS.
- Toda linha passa por `adminTenantRowSchema` (zod) antes do uso — resposta de
  PostgREST é dado não confiável. `plan` e `subscription_status` validados como
  enums de `src/types/domain.ts` (reuso de `SUBSCRIPTION_STATUSES`/plano).
- Busca/filtro **não** entram na `queryKey`: são estado de UI client-side sobre o
  resultado único (volume baixo no MVP; evita waterfall e mantém a lista
  instantânea ao digitar).

**`useChangeSubscriptionStatus()` — escrita por Edge Function (mutation):**

```
mutationFn(input: { tenantId: string; status: SubscriptionStatus; reason?: string }):
  supabase.functions.invoke("admin-subscription", {
    body: { action: "set_status", tenantId, status, reason }
  })
  → zod .parse() da resposta (changeStatusResponseSchema)
onSuccess: invalidateQueries(["admin","tenants"])
```

- O corpo **carrega `tenantId`** porque, diferente das escritas de tenant comuns
  (onde o servidor deriva o tenant do JWT), aqui o super admin opera **sobre
  outro** tenant por design. Mas isso **não** é "enviar tenant_id para contornar
  RLS": a autorização real é o servidor confirmar, pelo JWT/profiles, que o
  chamador é `super_admin` (§6). O `tenantId` é o alvo da operação, não a
  credencial. A Edge Function roda com service role e valida tudo.
- Resposta validada por zod (dado não confiável). Em erro, mapeia para pt-BR
  (§4.4).

### 4.2 Estado de UI — local, não servidor

Estado de busca (string), status selecionado no filtro (enum | "todos") e
abertura do dialog são `useState` locais em `EmpresasPage`/`EmpresaRow`. O
resultado filtrado é derivado com `useMemo` sobre `useAdminTenants().data` + os
filtros — **não** é estado novo, é computação. A contagem da signature (§2.5)
também é `useMemo` sobre o mesmo dado.

### 4.3 Formulário — react-hook-form + zod

`MudarStatusDialog` usa `useForm` com `zodResolver`. Schema do form
(`src/lib/validations/admin.ts`, novo):

```
changeStatusFormSchema = z.object({
  status: z.enum(SUBSCRIPTION_STATUSES),      // destino
  reason: z.string().trim().max(280).optional(),
})
```

- As **opções** do `Select` de destino são computadas de uma tabela de
  transições permitidas a partir do status atual — fonte única em
  `src/lib/subscription-status.ts` (novo, espelhando o padrão de
  `src/lib/scheduling-status.ts`). Transições sugeridas (a confirmar na análise
  de backend, pois a **validação canônica é no servidor** — §4.4/§6):
  - `trial` → `ativo | pendente | cancelado`
  - `ativo` → `pendente | bloqueado | cancelado`
  - `pendente` → `ativo | bloqueado | cancelado`
  - `bloqueado` → `ativo | cancelado`
  - `cancelado` → `ativo` (reativação) — demais bloqueadas
  - Nunca oferecer o mesmo status como destino (no-op) nem voltar a `trial`
    (trial é estado inicial, não destino operacional).
  A UI esconde destinos inválidos (defesa em profundidade); a Edge Function
  **rejeita** transição inválida de qualquer forma (a UI não é a trava).
- Mensagens de validação em pt-BR (ex.: motivo acima do limite: "O motivo deve
  ter no máximo 280 caracteres.").

### 4.4 Tratamento de erro (concreto, por operação)

Leitura (`useAdminTenants`):

- **Falha de rede / PostgREST**: recuperável. A query entra em `isError`; a tela
  mostra o `StatePanel` de erro (§1.3) com "Tentar novamente" → `refetch`. Não
  vazar a mensagem técnica. Logar no console só o técnico, sem PII.
- **Zero linhas por RLS** (papel sem permissão que de algum modo chegou à query):
  não é erro, é lista vazia — mas o guard de rota já impede esse caso. Defesa em
  profundidade: lista vazia renderiza o empty, nunca dado de outro tenant.

Escrita (`useChangeSubscriptionStatus` → Edge Function `admin-subscription`):
a resposta tem dois canais, como em `whatsapp` (ADR-04). Mapa pt-BR novo em
`src/lib/subscription-errors.ts` (espelha `whatsapp-errors.ts`):

| Condição (servidor) | HTTP | Recuperável? | O que o chamador recebe | Log |
|---|---|---|---|---|
| Sucesso | 200 | — | `{ ok: true, status }` → toast "Assinatura atualizada.", fecha dialog, invalida lista | servidor registra auditoria |
| Chamador não é super_admin | 403 | não (não deveria ocorrer; guard já barra) | "Sem permissão para esta ação." no dialog | servidor loga tentativa |
| Transição inválida | 422 | sim (operador escolhe outra) | "Transição de status não permitida." no dialog, dialog aberto | servidor loga rejeição |
| Tenant inexistente | 404 | não | "Empresa não encontrada." | servidor loga |
| Payload inválido (zod servidor) | 400 | sim | "Dados inválidos." | — |
| Sessão expirada | 401 | sim (relogar) | "Sua sessão expirou. Entre novamente." | — |
| Erro interno / rede | 500/502 | sim | "Não foi possível atualizar a assinatura. Tente novamente." | servidor loga técnico |

- Em qualquer falha, o dialog **permanece aberto** com a mensagem em `role="alert"`
  acima dos botões, e a lista **não** é invalidada (o estado não mudou). Só o
  sucesso fecha + invalida + toast.
- A resposta é validada por zod antes de ler `ok`/`status`; shape inesperado cai
  no ramo genérico ("Não foi possível atualizar..."), nunca quebra a tela.

### 4.5 Invariantes e dono da enforcement

| Invariante | Dono | Por quê |
|---|---|---|
| Só super_admin lê cross-tenant | **RLS** (`tenants_super_admin` SELECT) | Trava real no banco; a UI/guard é defesa em profundidade |
| Só super_admin muda status | **Edge Function** (service role + checagem de JWT/profiles) | O cliente não tem UPDATE de `subscription_status` (grant de coluna); escrita privilegiada e auditada |
| Transição de status válida | **Edge Function** | A UI esconde opções inválidas, mas a validação canônica é no servidor |
| Nenhum service role no bundle | **Edge Function / env** | Só anon key vai ao cliente (`src/lib/supabase.ts`) |
| `tenant_id` nunca do cliente para contornar RLS | **Cliente + RLS** | Leitura sem filtro de tenant; na escrita, `tenantId` é alvo, não credencial |

---

## 5. Critérios de aceite visual verificáveis (para o QA por ADR via Chrome DevTools)

Rodar com dois perfis (super_admin e um não-super-admin), em 390px (mobile) e
1280px (desktop), claro e escuro:

1. **Super admin — lista**: em `/admin/empresas`, a tabela (desktop) / cards
   (mobile) lista as empresas reais com Empresa (fantasia→razão social), Plano,
   badge de status e fim do trial; `trial_ends_at` nulo aparece como "—".
2. **Busca**: digitar parte de um nome filtra a lista em memória (sem novo
   request na aba Network); limpar a busca restaura a lista.
3. **Filtro por status**: escolher "Bloqueado" mostra só as bloqueadas; "Todos"
   restaura. Busca + filtro combinam (AND).
4. **Signature**: a contagem por status no topo bate com as linhas visíveis sem
   filtro.
5. **Estados**: loading mostra skeletons (não spinner); lista vazia mostra o
   empty "Nenhuma empresa ainda"; filtro sem match mostra "Nenhuma empresa
   encontrada" (texto distinto); erro de leitura mostra o painel de erro com
   "Tentar novemente" funcional.
6. **Mudar status (sucesso)**: abrir o dialog numa empresa, escolher um destino
   permitido, salvar → toast "Assinatura atualizada.", dialog fecha, o badge da
   linha reflete o novo status sem reload (invalidação da query dispara refetch
   na aba Network).
7. **Mudar status (transição inválida/erro)**: destinos inválidos não aparecem
   no select; se o servidor recusar (422), o dialog continua aberto com a
   mensagem pt-BR em `role="alert"` e a lista não muda.
8. **Não-super-admin barrado**: logado como `admin`/`receptionist`/`professional`,
   forçar `/admin/empresas` cai em `AccessDenied` (nenhuma linha de tenant é
   renderizada). Na aba Network, nenhuma leitura de `tenants` cross-tenant
   retorna dado para esse perfil (RLS devolve 0).
9. **Sem service role no bundle**: busca no bundle servido (DevTools → Sources /
   Network) por `service_role`/`SERVICE_ROLE` não acha nada; só a anon key
   pública está presente.
10. **Acessibilidade**: foco visível em busca, select, linhas e botões; `Tab`
    percorre em ordem; `Esc` fecha o dialog e devolve o foco ao gatilho;
    contraste dos badges de status medido ≥ 4.5:1 nos dois temas; console limpo
    (sem erro/aviso) em todos os passos.
11. **Responsivo**: 390px usa cards com ação full-width; 1280px usa tabela; sem
    scroll horizontal no mobile.

---

## 6. Dependências de dados (backend) — sinalizadas, não implementadas aqui

Esta fatia de **frontend** depende do backend entregar, como ADRs próprias do
pipeline (não é trabalho de frontend; aqui só desenho o consumo):

- **D1 — Policy de leitura cross-tenant**: `tenants_super_admin` (SELECT para
  `super_admin`) **já existe** na migration `20250216091000_profiles_and_helpers.sql`
  em master. A leitura do `useAdminTenants` apoia-se nela sem mudança. **Atenção
  de fronteira:** o PRD/análise de backend deve confirmar que essa policy
  continua SELECT (o hardening da branch `fix/seguranca-privilegios-profiles-tenants`
  reduz `profiles_super_admin` a SELECT e revoga UPDATE de `subscription_status`
  de `authenticated` — coerente com esta fatia). Se o hardening ainda não estiver
  em master quando a fatia for ao ar, **a escrita de `subscription_status` pelo
  cliente precisa estar fechada** (grant de coluna) para que a Edge Function seja
  o único caminho — senão o acceptance "nenhuma escrita de status pelo cliente"
  não se sustenta. Isto é um **gate de backend**.

- **D2 — Edge Function `admin-subscription` (NOVA, service role)**: não existe
  ainda. Deve seguir o padrão de `supabase/functions/whatsapp/` (resolver
  identidade pelo JWT via `service.auth.getUser` + `profiles`; service client com
  `SUPABASE_SERVICE_ROLE_KEY`; CORS; respostas pt-BR; logs sem PII). Contrato
  consumido pelo frontend:
  - **Entrada** (`action: "set_status"`, validada por zod no servidor):
    `{ action, tenantId: uuid, status: SubscriptionStatus, reason?: string≤280 }`.
    Qualquer campo extra ignorado. `tenantId` é o **alvo**; a credencial é o JWT.
  - **Regras do servidor (a trava real):** (a) `identity.role === "super_admin"`
    senão 403; (b) ler o tenant alvo com service role, 404 se não existir; (c)
    validar a transição `status_atual → status` contra a máquina de transições
    (fonte canônica no servidor; a UI só espelha) — 422 se inválida; (d) persistir
    `subscription_status` (e nada além disso); (e) **registrar auditoria** —
    quem (user id do super admin), qual tenant, de/para, motivo, quando.
  - **Saída:** sucesso `{ ok: true, status }` (200); condições de negócio com
    corpo próprio + status HTTP coerente (§4.4).

- **D3 — Tabela de auditoria (NOVA ou reuso)**: o registro da operação (D2.e)
  precisa de destino persistente. O projeto já tem `webhook_events` como padrão
  de auditoria de entrada (SELECT só admin, escrita só service role). Sugerir ao
  backend uma `admin_audit_log` análoga (ou campo/linha equivalente) — escrita
  exclusiva da Edge Function com service role, leitura restrita. A UI desta fatia
  **não** lê auditoria (fora de escopo); só garante que a escrita de status passa
  por um caminho que registra.

- **D4 — Segredos**: `SUPABASE_SERVICE_ROLE_KEY` e afins vivem no env das Edge
  Functions (já há `supabase/functions/.env.example`), **nunca** no bundle. Nada
  a fazer no frontend além de não importar segredo.

---

## 7. Fora de escopo desta fatia (não implementar)

- Criar ou apagar empresa (INSERT/DELETE de `tenants` revogados de todos os
  papéis do cliente — decisões de brain `tenants-insert-delete-so-service-role`).
  Esta fatia só lista e muda status.
- Editar cadastro do tenant (trade_name, legal_name, phone, document, timezone):
  é outra operação (residual S-06); não entra aqui.
- Instâncias de WhatsApp por tenant.
- Indicadores/métricas consolidadas da plataforma (a signature §2.5 é só contagem
  dos status já carregados, não o painel de métricas).
- `AdminDashboardPage` (`/admin`) continua placeholder.

---

## 8. Resumo das decisões travadas

1. Conteúdo real só em `EmpresasPage` (extraída para `src/admin/empresas/`),
   reusando casca, guards, `StatusBadge`, primitivos shadcn e o padrão de
   hook TanStack Query + zod de `useWhatsAppInstance`. Zero primitivo novo.
2. Leitura cross-tenant pelo cliente (anon key) apoiada no RLS `tenants_super_admin`
   SELECT — **sem** enviar `tenant_id`; o RLS é a trava.
3. Escrita de `subscription_status` **só** pela Edge Function `admin-subscription`
   (service role), que autentica super_admin pelo JWT, valida a transição,
   persiste e audita. `tenantId` no corpo é alvo, não credencial.
4. Filtros (busca por nome, status) são client-side sobre o resultado único da
   query; estados loading/empty(2 variantes)/erro em pt-BR.
5. Formulário de status com react-hook-form + zod; destinos inválidos escondidos
   na UI, validação canônica no servidor; erro mantém dialog aberto com
   `role="alert"`, sucesso fecha + invalida + toast.
6. Acessibilidade e contraste tratados pelos tokens do design system; contraste
   de badge **verificado** no QA (não afirmado sem medição).
7. Dependências de backend sinalizadas (D1 policy/gate de grant, D2 Edge
   Function, D3 auditoria, D4 segredos) — não implementadas neste doc de
   frontend.
