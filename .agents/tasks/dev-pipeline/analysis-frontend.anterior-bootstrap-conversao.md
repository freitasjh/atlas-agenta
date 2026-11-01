# Design de frontend: bootstrap do super_admin com troca obrigatória de senha

Status: design de frontend, sem código de aplicação. Base prevista: `origin/master` (61a8543, já com o PR #17).
O documento anterior deste arquivo (painel de Empresas, já mergeado) foi preservado em `analysis-frontend.anterior-empresas.md`.

## Visão geral

A demanda toca tela: o super_admin inicial entra com uma senha provisória, não abre o painel `/admin` até trocar a senha, e depois cai em `/admin/empresas`. A tela nova é a de troca de senha (`/trocar-senha`). O resto é guard, redirect e um hook de mutation.

O ponto de segurança mais importante para o frontend: o bloqueio do painel precisa valer no servidor. O guard de rota é só a camada de UX. O flag de troca obrigatória fica em `profiles.must_change_password`, uma coluna que o cliente não escreve. Ele nunca fica em `user_metadata`, porque o próprio usuário altera esse campo. A troca da senha passa por uma Edge Function com service role, que valida o usuário pelo JWT e zera o flag. O cliente nunca envia `role`, `tenant_id` nem o flag.

A senha fixa é provisória. Ela não aparece em nenhum texto, rótulo, dica ou log da UI. Nenhum componente do frontend importa ou referencia o literal.

Escopo visual: nenhum token novo, nenhum primitivo novo de `src/components/ui`. A tela reusa `AuthLayout`, `Card`, `Form`, `Input`, `Button`, `SignOutButton` e o padrão de alerta `role="alert"` das telas de login e redefinição.

---

## 1. Rotas, guards e fluxo

### 1.1 Mapa de rotas (alterado)

```
/login                    AuthLayout → LoginPage                       público
/trocar-senha   (NOVO)    AuthLayout → RequireAuth → TrocarSenhaPage   sessão, fora do guard de troca
/admin                    RequireAuth → RequirePasswordChange (NOVO)
                            → RequireRole(["super_admin"]) → AdminLayout
                            → index: <Navigate to="/admin/empresas" replace />   (era AdminDashboardPage)
/admin/empresas           mesma cadeia → EmpresasPage                  (sem mudança)
/app/*                    RequireAuth → RequirePasswordChange (NOVO)
                            → RequireActiveSubscription → AppLayout ...   (demais guards inalterados)
```

Decisões:

- **`RequirePasswordChange` entra nas duas árvores (`/app` e `/admin`)**, não só em `/admin`. O flag é uma propriedade do profile, não do papel. Um guard só no `/admin` deixaria uma conta de tenant com o flag ativo entrar no app. Se o flag só valer para super_admin hoje, o custo de cobrir `/app` também é zero, porque nenhum profile de tenant tem o flag ligado.
- **A ordem é fixa: autenticação, troca de senha, papel, assinatura.** A troca vem antes do RBAC porque o usuário pendente não deve ver nem mesmo a `AccessDenied` de outra área.
- **`/trocar-senha` fica fora do `RequirePasswordChange`.** Se ficasse dentro, o guard redirecionaria para a própria rota em loop. A página tem a regra inversa: se o flag já estiver zerado, manda o usuário para o destino do papel.
- **`/admin` (índice) redireciona para `/admin/empresas`.** Isso garante que nenhum caminho leve o super_admin ao placeholder `AdminDashboardPage`, inclusive um `from=/admin` que o login preserva. O componente `AdminDashboardPage` fica no arquivo, sem rota. A remoção dele é outra demanda.

### 1.2 Guard novo: `RequirePasswordChange`

Arquivo: `src/app/guards/RequirePasswordChange.tsx`. Mesmo molde de `RequireRole`, sem o check de papel.

- Carregando (`isLoadingAuth`) → `RouteFallback`.
- Sessão com profile ilegível (`hasProfileError` ou `hasTenantError`) → `DefensiveLogout` (postura anti "fail-open" já existente).
- `mustChangePassword === true` → `<Navigate to="/trocar-senha" replace />`. Não preserva `state.from`. Depois da troca, o destino é decidido pelo papel, não pela rota pedida.
- Caso contrário → `<Outlet />`.

Sem sessão, o guard não decide nada: `RequireAuth` já está antes e manda para `/login`.

### 1.3 Estado derivado: `useCurrentUser`

Acrescentar `mustChangePassword: boolean` à interface `CurrentUser`, calculado como `profile?.must_change_password === true`. A comparação estrita evita que um valor ausente vire `false` por acidente quando o profile carregar. A falta do campo já é tratada como erro de profile: o zod de `useProfile` falha e cai em `hasProfileError`.

### 1.4 Redirect pós-login (`usePostLoginRedirect`)

Hoje o hook respeita `from` antes de ler o profile. Isso pularia a checagem do flag. A nova ordem é:

1. Ler `role` e `must_change_password` do profile da sessão. Sempre, mesmo com `from`.
2. Se `must_change_password` for `true` → `/trocar-senha`. `from` é ignorado.
3. Se houver `from` → `from`.
4. `super_admin` → `/admin/empresas`. Demais papéis → `/app`.
5. Erro de leitura → `/app`. Os guards reavaliam e, sem profile legível, encerram a sessão.

A decisão vai para uma função pura, `resolvePostLoginDestination({ role, mustChangePassword, from })`, em `src/auth/`. O hook só lê o profile e chama essa função. A função pura é testável sem React (ver §7).

Na leitura do profile, o hook usa `queryClient.fetchQuery` com a mesma `queryFn` de `useProfile` (função `fetchProfile(userId)` exportada de `src/hooks/useProfile.ts`). Assim o shape e a validação zod ficam num lugar só, e o hook deixa de fazer um `supabase.from` próprio.

### 1.5 Tela `/trocar-senha`

Arquivo novo: `src/auth/TrocarSenhaPage.tsx`, exportado por `src/auth/pages.tsx`, como as outras telas de auth.

Comportamento:

- Sem sessão → não renderiza o formulário (o `RequireAuth` do router já redirecionou).
- `mustChangePassword === false` ao montar → `<Navigate>` para o destino do papel, via `resolvePostLoginDestination`. Isso cobre o refresh depois da troca e o acesso direto com o flag já zerado.
- Formulário com `react-hook-form` + `zodResolver(resetPasswordSchema)`. O schema já existe em `src/lib/validations/auth.ts`, com `password` mínimo de 8 caracteres e `confirmPassword` igual. Reuso sem schema novo, porque a regra é a mesma.
- Botão "Sair" (`SignOutButton` existente) abaixo do formulário. Sem ele, uma sessão presa no bloqueio não tem saída visível.

Fluxo de submit (uma única mutation, `useChangeInitialPassword`):

1. `supabase.functions.invoke("trocar-senha-inicial", { body: { password } })`. O cliente manda só a senha. O JWT da sessão vai no header automaticamente. O `userId` sai do token no servidor, nunca do corpo.
2. Sucesso (200): `form.reset()`, `queryClient.invalidateQueries({ queryKey: ["profile"] })`, `toast.success("Senha atualizada. Painel liberado.")`, e navegar para o destino do papel com `replace`.
3. Falha: manter a tela, mostrar a mensagem pt-BR em `role="alert"` com foco (mesmo padrão do `LoginPage`). Mapeamento na §4.3.

Estados visuais da tela:

| Estado | Visual |
|---|---|
| Verificando sessão | `RouteFallback` do guard, sem flash do formulário |
| Formulário | Card, dois campos, botão primário "Salvar nova senha" |
| Enviando | Botão desabilitado, rótulo "Salvando…", ícone `Loader2` com `aria-hidden` |
| Erro de validação | `FormMessage` abaixo do campo, borda do campo em `destructive` (padrão shadcn) |
| Erro do servidor | Alerta `role="alert"` acima do formulário, com foco |
| Sucesso | Toast e navegação. Sem tela intermediária |

Copy (pt-BR, voz de interface, sem desculpas):

- Título: "Defina sua nova senha"
- Descrição: "Esta é sua primeira entrada. Troque a senha provisória para liberar o painel."
- Rótulos: "Nova senha" e "Confirmar nova senha"
- Ajuda do campo: "Use ao menos 8 caracteres."
- Botão: "Salvar nova senha"
- Validação: "A senha deve ter ao menos 8 caracteres." e "As senhas não coincidem." (já existem no schema)

A tela não mostra a senha provisória, não menciona "senha padrão" e não tem dica de login.

### 1.6 Login

`LoginPage` não muda. A mudança fica em `usePostLoginRedirect`. Não colocar nenhum texto novo no login, nem aviso de "primeiro acesso", porque o login é público e exibiria o comportamento do bootstrap.

### 1.7 Casos de borda

- **Reset de senha por e-mail com flag ligado.** A recuperação troca a senha, mas não zera o flag. O usuário é mandado de novo para `/trocar-senha`. Isso é fail-closed e aceitável para o bootstrap. Registrado em §8 como decisão.
- **Recuperação termina em `/app`.** `RedefinirSenhaPage` navega para `/app` depois da troca. Para o super_admin com flag zerado, `/app` mostra a casca do tenant, porque `RequireActiveSubscription` deixa passar `super_admin`. Já era assim antes desta demanda. Fica em §8 como item de fora de escopo.
- **Falha após a troca de senha.** A Edge Function troca a senha antes de zerar o flag. Se a segunda parte falhar, o usuário continua na tela com o flag ligado e a senha nova já aceita. Ao repetir a submissão, a Edge Function aceita a mesma senha pelo caminho admin. O estado final é sempre fail-closed.
- **Sessão expirada na submissão (401).** A tela mostra "Sua sessão expirou. Entre novamente." com link para `/login`. Não força logout silencioso.
- **Refresh em `/trocar-senha` depois da troca.** O profile já foi invalidado e o flag veio `false`. A tela redireciona sem renderizar o formulário.
- **Duas abas.** Uma aba com a troca feita e outra aberta na tela de troca: a outra recebe o refetch do profile no próximo foco, ou na próxima submissão, e redireciona.

---

## 2. Direção visual e design system

### 2.1 Princípio

A tela é um passo único e obrigatório, não uma página de marketing. O objetivo é que a pessoa entenda que ainda não pode entrar e saiba o que falta fazer. A personalidade da tela é a da casca de auth que já existe: calma, direta, sem decoração. Uma marca própria para esta tela não é necessária, e uma tela mais "bonita" aqui competiria com a mensagem de bloqueio.

### 2.2 Tokens (reuso, zero token novo)

- **Cor de fundo, texto e card**: tokens semânticos existentes (`background`, `foreground`, `card`, `muted-foreground`, `border`).
- **Botão primário**: `Button` default (`primary`).
- **Marcador de "ação pendente"**: a tela usa um traço vertical à esquerda do card e um chip com ícone de cadeado. Os dois usam `bg-status-pendente` e `text-status-pendente-foreground`, o mesmo par do status `pendente`. A semântica é "algo está pendente e exige ação", o que bate com o estado. O traço é decorativo (`aria-hidden`), então não exige contraste de texto. O chip tem texto próprio: "Primeiro acesso".
- **Tipografia**: título com `font-display` (Space Grotesk, já carregado via `@fontsource`), corpo em Inter (fonte base). Nenhuma família nova.
- **Espaçamento e raio**: a régua do `AuthLayout` (`space-y-4` nos campos, `rounded-lg` do `Card`). Sem valores arbitrários.

### 2.3 Layout (mobile-first)

```
Mobile (390px)                       Desktop (1280px)
┌────────────────────────┐          ┌──────────────┬──────────────────┐
│ [Logo]          [tema] │          │ aside (card) │ [tema]           │
│                        │          │ (highlights  │                  │
│ ┃ [🔒 Primeiro acesso] │          │  do AuthLayout)│  ┃ [🔒 Primeiro] │
│ ┃ Defina sua nova     │          │              │  ┃ Defina sua... │
│ ┃ senha               │          │              │  ┃ [Nova senha]   │
│ ┃ [Nova senha     ]   │          │              │  ┃ [Confirmar  ]  │
│ ┃ [Confirmar      ]   │          │              │  ┃ [Salvar     ]  │
│ ┃ [Salvar nova senha] │          │              │  ┃ Sair           │
│ ┃ Sair                │          │              │                  │
└────────────────────────┘          └──────────────┴──────────────────┘
```

- Mobile: uma coluna, botão em largura total, como no login.
- Desktop: a aside do `AuthLayout` continua visível. Ela lista os destaques do produto, o que é ruído para o super_admin nesse momento. Trade-off aceito: reaproveitar o layout sem alterá-lo. Se o QA julgar o ruído grave, a alternativa é a prop `variant` no `AuthLayout`, em demanda separada.
- O card ocupa `max-w-md` (já é o padrão do `AuthLayout`). Nenhum scroll horizontal em 390px.

### 2.4 Estados de componente

- Campos: borda do `Input` padrão, `focus-visible` com `ring` do tema (não sobrescrever).
- Botão desabilitado durante envio: `disabled` do `Button`, sem `opacity` manual.
- Alerta de erro: mesmo bloco do `LoginPage` (`border-destructive/40 bg-destructive/10 text-destructive`).
- Nenhuma animação nova. Se houver transição de rota, ela segue a do app. Sem movimento além do foco.

### 2.5 Signature

O único toque próprio é o traço de "pendente" com o chip "Primeiro acesso" no topo do card. Ele diz visualmente que a tela é obrigatória e não é uma tela de conta. O resto é disciplina de formulário.

---

## 3. Acessibilidade

### 3.1 Requisitos da tela nova

- Cada campo tem `<label>` associado via `FormLabel`/`FormControl` (shadcn). Sem placeholder como rótulo.
- `FormDescription` ("Use ao menos 8 caracteres.") ligado ao campo por `aria-describedby`, que o shadcn `Form` já faz.
- `autoComplete="new-password"` nos dois campos, para o gerenciador de senhas oferecer e salvar a senha nova.
- `autoFocus` no campo "Nova senha" ao montar. É a única tarefa da tela, então o foco inicial é correto.
- Em erro de servidor, o alerta recebe foco (`tabIndex={-1}` + `ref.focus()`), igual ao `LoginPage`.
- Ordem de tab: campo 1, campo 2, "Salvar nova senha", "Sair". Enter no campo 2 envia o formulário.
- Logo e botão de tema seguem os do `AuthLayout` (já com foco visível).

### 3.2 Contraste medido (WCAG 2.x, calculado a partir dos tokens de `src/index.css`)

Cálculo feito com a fórmula de luminância relativa sobre os valores HSL do arquivo. Os pares do chip e do alerta da tela nova são os que aparecem nesta tela. Os demais são do tema já existente.

| Par (texto / fundo) | Claro | Escuro | Requisito | Situação |
|---|---|---|---|---|
| `foreground` / `background` | 16,84 | 16,72 | 4,5 | passa nos dois temas |
| `muted-foreground` / `background` | 5,52 | 7,46 | 4,5 | passa |
| `muted-foreground` / `card` | 5,65 | 6,75 | 4,5 | passa |
| `status-pendente-fg` / `status-pendente` (chip "Primeiro acesso") | 5,98 | 7,91 | 4,5 | passa |
| `destructive` / `background` (texto do alerta) | 5,12 | **4,18** | 4,5 | **escuro falha** |
| `primary-foreground` / `primary` (botão "Salvar") | **3,23** | 7,23 | 4,5 | **claro falha** |
| `primary` / `background` (link "Sair", se usado como link) | **3,27** | 7,57 | 4,5 | **claro falha** |
| `ring` / `background` (foco visível) | **2,71** | 9,91 | 3,0 (1.4.11) | **claro falha** |
| `border` / `background` (contorno do campo) | **1,37** | 1,49 | 3,0 (1.4.11) | **falha nos dois temas** |

Leitura:

- O chip e o texto de corpo passam nos dois temas.
- Quatro pares falham e já existem no app inteiro, não só nesta tela. O botão primário claro (3,23), o foco claro (2,71), o contorno do campo (1,37 nos dois temas) e o texto de erro escuro (4,18, medido sobre o fundo; sobre `destructive/10` deve ser medido no QA). Esta demanda não cria cor nova. Ela herda esses pares.
- Corrigir os tokens afeta o app todo. Não faz parte deste bootstrap, então vai para decisão do usuário (ver §8, pergunta 2).
- O QA deve medir os pares reais com o Chrome DevTools (cor computada do texto e do fundo efetivo), não só os tokens.

### 3.3 Foco e teclado

- Todo elemento interativo é `button`, `a` ou `input` nativo. Nenhum `div` clicável.
- Foco visível preservado (não sobrescrever `focus-visible:` dos primitivos).
- Nenhuma armadilha de foco: a tela não é modal.

### 3.4 Movimento

- Nenhuma animação própria. `prefers-reduced-motion` não precisa de tratamento extra nesta tela.

---

## 4. Arquitetura React

### 4.1 Divisão: componente, hook e estado de servidor

| Camada | Itens |
|---|---|
| Componentes (novos) | `src/auth/TrocarSenhaPage.tsx`, `src/app/guards/RequirePasswordChange.tsx` |
| Componentes (reuso) | `Card*`, `Form*`, `Button`, `Input`, `SignOutButton`, `RouteFallback`, `DefensiveLogout`, `AccessDenied` |
| Hooks (alterados) | `useProfile` (campo novo e `fetchProfile` exportada), `useCurrentUser` (`mustChangePassword`), `usePostLoginRedirect` (ordem nova e `fetchQuery`) |
| Hook de mutation (novo) | `useChangeInitialPassword` em `src/hooks/useAuthMutations.ts` |
| Função pura (nova) | `resolvePostLoginDestination` em `src/auth/` |
| Estado de servidor | `["profile", userId]` (TanStack Query, única fonte do flag) e `["session"]` (já existe) |

Nada de `fetch` solto em `useEffect`. O único `useEffect` novo é o foco do alerta, o mesmo padrão do login.

### 4.2 Contrato de dados

Leitura do flag, `useProfile`:

```
select("id, role, tenant_id, must_change_password").eq("id", userId).single()
zod: { id: string, role: enum, tenant_id: string|null, must_change_password: boolean }
```

- O filtro `.eq("id", userId)` é o mesmo do código atual. Não é filtro de tenant. O `userId` vem da sessão, não do cliente.
- A policy `profiles_select_same_tenant` já deixa o usuário ler a própria linha (`id = auth.uid()`). A leitura do flag funciona mesmo com o flag ligado, o que é necessário para o guard decidir.

Escrita, `useChangeInitialPassword`:

```
mutationFn({ password }) → supabase.functions.invoke("trocar-senha-inicial", { body: { password } })
```

- Corpo: somente `password`. Sem `tenantId`, sem `userId`, sem `role`, sem o flag.
- O cliente usa anon key + sessão do usuário. Nenhum segredo, nenhuma service role no bundle.
- `onSuccess`: `invalidateQueries({ queryKey: ["profile"] })`. Não invalidar `["session"]`, porque o JWT continua válido.

### 4.3 Erros da troca (mapeamento para pt-BR)

Função nova `mapInitialPasswordError(error)` em `src/lib/auth-errors.ts`, ao lado de `mapAuthError`. Nunca lança.

| Causa (código do servidor) | Mensagem na tela | Ação |
|---|---|---|
| 422 validação (`password`) | "A senha deve ter ao menos 8 caracteres." | Fica na tela, foco no campo |
| 401 sessão inválida | "Sua sessão expirou. Entre novamente." com link para `/login` | Sem logout silencioso |
| 409 flag já zerado | Nenhuma mensagem. Invalida o profile e redireciona | Sucesso efetivo |
| 5xx ou rede | "Não foi possível salvar a nova senha. Tente novamente." | Fica na tela, botão reativado |

O detalhe técnico do erro vai para `console.error` em inglês, sem corpo da requisição e sem senha. A mensagem vinda do servidor nunca vai para a tela. Isso evita vazar texto do banco ou do GoTrue.

### 4.4 Proteção da senha no cliente

- A senha não entra em query key, cache do TanStack Query, `localStorage` ou log.
- `mutationFn` recebe a senha como argumento e não a guarda em estado.
- `form.reset()` depois do sucesso, antes da navegação.
- Nenhum `console.log` de valores do formulário.
- O bundle não contém o literal da senha fixa. O QA verifica (§7).

### 4.5 Ordem de avaliação no boot

`RequireAuth` (sessão) → `RequirePasswordChange` (flag) → `RequireRole` (papel) → `RequireActiveSubscription` (assinatura, só `/app`) → página. Cada guard lê de `useCurrentUser`, que lê de `useProfile`, uma única query com cache.

---

## 5. Regras de servidor que a UI depende

A UI depende destas peças. Cada uma é dependência de dados e de backend, não trabalho de frontend. Sem elas, a tela não fecha a segurança.

**D1. Coluna do flag com trigger de bloqueio.** Migration nova: `profiles.must_change_password boolean not null default false`. Trigger `BEFORE UPDATE` em `profiles` que levanta `insufficient_privilege` (42501) quando `auth.role() = 'authenticated'` e `role`, `tenant_id` ou `must_change_password` mudam. Mesmo padrão de `tenants_guard_privileged_columns` (migration 20250227091000). Escolha de trigger, não de grant de coluna, porque o trigger não depende da hardening de grants que o brain descreve em outra branch (`20250228090000`, ainda não em `master`). A escrita do flag fica só para service role. Não há policy de INSERT do cliente em `profiles`, o que já existe.

**D2. RLS que bloqueia o painel no banco.** Helper novo `current_must_change_password()` (security definer, `search_path` fixo, lê `profiles` por `auth.uid()`). As policies de leitura cross-tenant do super_admin (`tenants_super_admin_select` e a policy de SELECT de `profiles` para super_admin) passam a incluir `and not current_must_change_password()`. Resultado: com o flag ligado, o super_admin lê zero linhas de outras empresas, mesmo chamando o PostgREST direto. A leitura da própria linha do profile (`profiles_select_same_tenant`, `id = auth.uid()`) não muda, para o guard conseguir ler o flag.

**D3. Edge Function `trocar-senha-inicial`** (nome final a cargo do backend). Molde: `supabase/functions/admin-subscription/index.ts` (`resolveIdentity` pelo JWT, service client, CORS, respostas JSON em pt-BR).

- Identidade pelo JWT (`auth.getUser(token)`). Nunca pelo corpo.
- Corpo validado com zod: `{ password: string }`, mínimo 8 e máximo 72 bytes (limite do bcrypt no GoTrue). Qualquer outra chave é rejeitada.
- Se o profile não tiver o flag ligado → 409.
- Ordem: (a) `auth.admin.updateUserById(userId, { password })`; (b) `update profiles set must_change_password = false where id = userId and must_change_password = true`. Se (b) falhar, o flag continua ligado (fail-closed) e a tela pode repetir a submissão.
- Logs técnicos em inglês, sem senha, sem e-mail, sem o corpo da requisição.
- Resposta 200 com `{ ok: true }`. Nunca devolve a senha nem o hash.

**D4. Bloqueio nas demais funções de super_admin.** A Edge Function `admin-subscription` resolve o profile pelo JWT. Ela passa a recusar com 403 e código `password_change_required` quando o flag estiver ligado. A UI não depende disso para a navegação, mas a defesa vale para chamadas diretas.

**D5. Bootstrap do super_admin.** Cria o usuário em `auth.users` (e-mail confirmado), o vínculo de identidade, o profile `super_admin` com `tenant_id` nulo e `must_change_password = true`. Idempotente: se o e-mail já existir, não recria nem sobrescreve. A senha fixa vive só no backend, nunca no frontend. O mecanismo (migration, seed ou função) é decisão de ADR. O frontend não depende dele, exceto pelo e-mail usado no login (ver §8, pergunta 1).

**Sem dependência de dados:** `src/router.tsx` não depende de nada de banco. A rota nova e os guards são só frontend.

---

## 6. Arquivos afetados

Alterados:

- `src/types/domain.ts`: `CurrentProfile` ganha `must_change_password: boolean`.
- `src/hooks/useProfile.ts`: `select` e schema zod com o campo novo; exporta `fetchProfile(userId)`.
- `src/hooks/useCurrentUser.ts`: campo `mustChangePassword`.
- `src/auth/usePostLoginRedirect.ts`: ordem nova (flag antes de `from`), leitura via `fetchQuery`, chamada a `resolvePostLoginDestination`.
- `src/auth/pages.tsx`: exporta `TrocarSenhaPage`.
- `src/hooks/useAuthMutations.ts`: `useChangeInitialPassword`.
- `src/lib/auth-errors.ts`: `mapInitialPasswordError`.
- `src/router.tsx`: rota `/trocar-senha`; `RequirePasswordChange` nas árvores `/app` e `/admin`; índice de `/admin` vira `<Navigate to="/admin/empresas" replace />`.

Criados:

- `src/auth/TrocarSenhaPage.tsx`.
- `src/app/guards/RequirePasswordChange.tsx`.
- `src/auth/resolvePostLoginDestination.ts` (função pura).
- Testes unitários (ver §7).

Backend (fora deste frontend, citado para rastreio): migration do flag, trigger, helper e policies de super_admin, Edge Function `trocar-senha-inicial`, ajuste em `admin-subscription`, bootstrap.

Não alterados: `LoginPage`, `RedefinirSenhaPage`, `AuthLayout`, `AdminLayout`, `EmpresasPage`, `src/index.css`, `tailwind.config.ts`, `src/components/ui/*`.

---

## 7. Testabilidade e critério de aceite visual

### 7.1 Testes

Unitários (vitest, sem rede):

- `resolvePostLoginDestination`: flag ligado com `from` → `/trocar-senha`. Flag desligado com `from` → `from`. `super_admin` sem `from` → `/admin/empresas`. `super_admin` com `from=/admin` → `/admin/empresas`. Admin de tenant → `/app`. Erro → `/app`.
- `mapInitialPasswordError`: 422, 401, 409, 5xx e erro de rede mapeiam para as mensagens da §4.3, e nenhum texto bruto do servidor aparece.
- `useProfile` (zod): aceita `must_change_password` booleano, rejeita ausência do campo.

Integração (banco, pgTAP ou script SQL em `supabase db reset`):

- Cliente autenticado não consegue `update profiles set must_change_password = false` (erro 42501).
- Cliente autenticado não consegue `update profiles set role = ...` nem `tenant_id = ...` (42501).
- Super_admin com flag ligado não lê `tenants` de outras empresas (0 linhas). Com flag zerado, lê.
- Edge Function: 401 sem JWT, 409 com flag zerado, 200 com flag ligado, e o flag fica zerado depois.
- Bootstrap: rodar duas vezes não cria segundo super_admin nem troca a senha existente.

E2E com Chrome DevTools (§7.2).

### 7.2 Critério de aceite visual (QA por ADR)

Pré-condição: `supabase db reset` aplicado, bootstrap rodado, app servido em `127.0.0.1`.

Fluxo (repetir em 390px e 1280px, claro e escuro):

1. Abrir `/admin/empresas` sem sessão → redireciona para `/login`.
2. Login com o e-mail do bootstrap e a senha provisória → URL final `/trocar-senha`. Título "Defina sua nova senha" visível. Nenhum texto de `EmpresasPage` no DOM.
3. Acessar `/admin/empresas` direto pela barra de endereço → permanece em `/trocar-senha`. A tabela não renderiza.
4. Enviar com senhas diferentes → "As senhas não coincidem." abaixo do campo "Confirmar nova senha".
5. Enviar com 5 caracteres → "A senha deve ter ao menos 8 caracteres.".
6. Enviar senha válida e igual → toast "Senha atualizada. Painel liberado." e URL `/admin/empresas`.
7. Recarregar a página → continua em `/admin/empresas`. Acessar `/trocar-senha` → redireciona para `/admin/empresas`.
8. Acessar `/admin` → `/admin/empresas` (índice).
9. Sair e entrar de novo com a senha nova → `/admin/empresas`. Com a senha provisória → "E-mail ou senha incorretos.".
10. Teste negativo: login de usuário de tenant (admin) não passa por `/trocar-senha` e chega em `/app`. A troca de flag por esse usuário falha (ver §7.1).

Visual e técnico:

- Console sem erro nem aviso em nenhum passo (`list_console_messages`).
- Rede: a requisição de troca não mostra a senha na resposta. A resposta é `{ ok: true }` ou o erro mapeado.
- Bundle: `grep` do literal da senha provisória em `dist/` retorna zero resultados.
- 390px: sem scroll horizontal (`scrollWidth <= clientWidth`). Botão em largura total. Campos legíveis.
- 1280px: aside do `AuthLayout` visível. Card centralizado.
- Contraste medido na tela de troca (claro e escuro): texto de corpo, chip, botão e alerta. Os pares já marcados como falhando em §3.2 são registrados no QA, sem bloquear o aceite desta demanda, a menos que o usuário decida o contrário.
- Teclado: tab na ordem da §3.1, Enter envia, foco visível em todos os elementos.
- Screenshot de referência de cada combinação (390/1280 × claro/escuro) para o QA comparar nas próximas fatias.

---

## 8. Dúvidas em aberto e riscos

1. **E-mail do super_admin.** O pedido original ainda pergunta qual é o usuário. O frontend não guarda e-mail no código, mas o bootstrap precisa dele. Precisa de resposta antes da execução.
2. **Pares de contraste que falham no app inteiro.** O botão primário claro (3,23), o foco claro (2,71), o contorno do campo (1,37) e o texto de erro escuro (4,18). Corrigir é mudar tokens em `src/index.css`, o que altera o app todo. Não está no escopo deste bootstrap. Pergunta: abrir demanda separada de tokens?
3. **Flag para todos os papéis ou só super_admin.** Assumi que o mecanismo é genérico (qualquer profile pode ter o flag) e que o guard vale em `/app` e `/admin`. Se o usuário preferir restringir ao super_admin, o guard continua igual, mas o redirect ganha um check de papel. Confirmar.
4. **Recuperação de senha por e-mail não zera o flag.** Assumi que é aceitável (fail-closed), porque a troca forçada é a regra do bootstrap. Confirmar.
5. **Super_admin cai na casca de tenant depois da recuperação de senha** (`RedefinirSenhaPage` navega para `/app`). É comportamento anterior, fora desta demanda. Sinalizado para uma demanda própria.
6. **Senha fixa em produção.** A decisão do usuário é aceita e registrada. Como a migration roda em todos os ambientes, o literal fica no repositório. Antes do beta, trocar por senha gerada por ambiente, sem literal no código (já registrado no brain).
7. **Base da branch.** O PR #17 está em `origin/master` (61a8543). A árvore local está em `feat/super-admin-empresas` com arquivos de pipeline não commitados. A branch nova deve sair de `origin/master`, sem reaproveitar a atual.

---

## 9. Respostas a achados de revisão

Não há revisão anterior de design para esta demanda. Nada a responder.
