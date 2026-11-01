# Design de frontend: bootstrap do super_admin direto, com troca obrigatória de senha

Status: design de frontend. Sem código de aplicação.
Base: `feat/adr-01-password-gate` @ `0225d19`. Não usar `origin/master`.
Substitui o desenho de conversão (ADR-04, `bootstrap_super_admin`). O documento anterior foi preservado em `analysis-frontend.anterior-bootstrap-conversao.md`.

## 1. Visão geral

A demanda toca tela. O super_admin inicial (`admin@neox.com.br`) entra com a senha provisória, não abre `/admin` até trocar a senha e, depois da troca, cai em `/admin/empresas`. A tela nova é `/trocar-senha`. O restante é guard, redirect e uma mutation.

Mudança de mecanismo em relação ao desenho anterior: o super_admin nasce com `profiles.role = 'super_admin'` e `tenant_id = null`, criado pelo servidor. Não existe tenant órfão, não existe conversão e não existe tela de onboarding envolvida. Para o frontend isso simplifica: não há estado intermediário de "cadastro de empresa" a tratar.

Duas regras de segurança determinam o desenho:

- O bloqueio do painel vale no servidor (RLS e Edge Function). O guard de rota é só a camada de UX.
- O flag `profiles.must_change_password` é a única fonte de verdade da troca obrigatória. Ele não fica em `user_metadata`. O cliente nunca escreve esse flag, `role`, `tenant_id` nem o marcador de bootstrap (`raw_app_meta_data->>'bootstrap_role'`).

Escopo visual: nenhum token novo e nenhum primitivo novo em `src/components/ui`. A tela reusa `AuthLayout`, `Card`, `Form`, `Input`, `Button` e `SignOutButton`.

Estado do backend na base `0225d19` (verificado nos arquivos):

| Peça | Situação |
|---|---|
| Coluna `profiles.must_change_password` e helper `current_must_change_password()` | Existe (`20250228090000`) |
| Guard de colunas privilegiadas de `profiles` (inclui o flag) | Existe (`20250228091500`, `20250228091700`) |
| Policies cross-tenant do super_admin bloqueadas enquanto o flag está ligado | Existe (`20250228091800`) |
| Trigger `handle_new_user` com ramo `bootstrap_role` | Não existe. Ver §5 |
| Edge Function `trocar-senha-inicial` | Não existe. Ver §5 |
| Checagem do flag em `admin-subscription` | Não existe. Ver §5 |
| Bootstrap do super_admin (novo mecanismo) | Não existe. A função `bootstrap_super_admin` e as migrations `20250228092000` a `092300` ainda estão na branch e serão removidas. Ver §5 |

## 2. Rotas, guards e fluxo

### 2.1 Mapa de rotas

```
/login                    AuthLayout → LoginPage                              público
/trocar-senha  (NOVO)     AuthLayout → RequireAuth → TrocarSenhaPage          sessão; fora do guard de troca
/admin                    RequireAuth → RequirePasswordChange (NOVO)
                            → RequireRole(["super_admin"]) → AdminLayout
                            → index: <Navigate to="/admin/empresas" replace /> (era AdminDashboardPage)
/admin/empresas           mesma cadeia → EmpresasPage                         (sem mudança)
/app/*                    RequireAuth → RequirePasswordChange (NOVO)
                            → RequireActiveSubscription → AppLayout ...        (demais guards inalterados)
```

Decisões:

- **`RequirePasswordChange` entra nas duas árvores (`/app` e `/admin`).** O flag é do profile, não do papel. Um guard só em `/admin` deixaria uma conta de tenant com o flag ligado entrar no app. Nenhum profile de tenant tem o flag ligado hoje, então o custo é zero.
- **Ordem fixa: sessão, troca de senha, papel, assinatura.** A troca vem antes do RBAC, para que o usuário pendente não veja a tela `AccessDenied` de outra área.
- **`/trocar-senha` fica fora do `RequirePasswordChange`.** Dentro dele, o guard mandaria a rota para ela mesma em loop. A própria página faz a checagem inversa: se o flag já estiver zerado, redireciona para o destino do papel.
- **`/admin` (índice) vira `<Navigate to="/admin/empresas" replace />`.** Nenhum caminho leva o super_admin ao placeholder `AdminDashboardPage`, nem mesmo um `from=/admin` preservado pelo login. O componente fica no arquivo, sem rota. Remover o componente é outra demanda.

### 2.2 Guard novo: `RequirePasswordChange`

Arquivo: `src/app/guards/RequirePasswordChange.tsx`. Mesmo molde de `RequireRole`, sem a checagem de papel.

- `isLoadingAuth` → `RouteFallback`.
- `hasProfileError` ou `hasTenantError` com sessão → `DefensiveLogout`.
- Sem sessão → `<Outlet />`. Quem decide é o `RequireAuth`, que vem antes.
- `mustChangePassword === true` → `<Navigate to="/trocar-senha" replace />`. Não preserva `state.from`. Depois da troca, o destino é decidido pelo papel.
- Caso contrário → `<Outlet />`.

### 2.3 Estado derivado: `useCurrentUser`

Acrescentar `mustChangePassword: boolean`, calculado como `profile?.must_change_password === true`. A comparação estrita impede que um valor ausente vire `false` por acidente. Campo ausente no payload já cai em `hasProfileError`, porque o schema zod de `useProfile` falha.

### 2.4 Leitura do profile: `useProfile`

Acrescentar `must_change_password` ao `select` e ao schema zod. Exportar `fetchProfile(userId)` para que `usePostLoginRedirect` reuse a mesma `queryFn` e a mesma validação.

```
select("id, role, tenant_id, must_change_password").eq("id", userId).single()
zod: { id: string, role: enum, tenant_id: string|null, must_change_password: boolean }
```

O `.eq("id", userId)` é o mesmo de hoje. O `userId` vem da sessão, não é filtro de tenant. A policy `profiles_select_same_tenant` permite ao usuário ler a própria linha, então a leitura do flag funciona com o flag ligado.

### 2.5 Redirect pós-login: `usePostLoginRedirect`

Hoje o hook respeita `from` antes de ler o profile, o que pularia a checagem do flag. A ordem nova:

1. Ler `role` e `must_change_password` do profile. Sempre, mesmo com `from`.
2. `must_change_password === true` → `/trocar-senha`. `from` é ignorado.
3. Há `from` → `from`.
4. `super_admin` → `/admin/empresas`. Demais papéis → `/app`.
5. Erro de leitura → `/app`. Os guards reavaliam e, sem profile legível, encerram a sessão.

A decisão vai para uma função pura, `resolvePostLoginDestination({ role, mustChangePassword, from })`, em `src/auth/resolvePostLoginDestination.ts`. O hook só lê o profile e chama a função. O hook usa `queryClient.fetchQuery` com `fetchProfile`. Ele deixa de fazer um `supabase.from` próprio.

### 2.6 Tela `/trocar-senha`

Arquivo: `src/auth/TrocarSenhaPage.tsx`, reexportado por `src/auth/pages.tsx`.

- Sem sessão: não renderiza o formulário (o `RequireAuth` já redirecionou).
- `mustChangePassword === false` ao montar: `<Navigate>` para o destino de `resolvePostLoginDestination`. Cobre refresh depois da troca e acesso direto.
- Formulário com `react-hook-form` e `zodResolver(resetPasswordSchema)`. O schema existe em `src/lib/validations/auth.ts` (senha mínima de 8 caracteres e confirmação igual). Não há schema novo porque a regra é a mesma.
- `SignOutButton` abaixo do formulário. Sem ele, uma sessão presa no bloqueio não tem saída visível.

Mutation `useChangeInitialPassword` (em `src/hooks/useAuthMutations.ts`):

1. `supabase.functions.invoke("trocar-senha-inicial", { body: { password } })`. O corpo tem só a senha. O JWT vai no header. O `userId` sai do token no servidor.
2. Sucesso: `form.reset()`, `invalidateQueries({ queryKey: ["profile"] })`, toast `"Senha atualizada. Painel liberado."`, navegação para o destino do papel com `replace`.
3. Falha: a tela continua, com a mensagem em `role="alert"` e foco no alerta (mesmo padrão do `LoginPage`). Mapeamento na §3.3.

Estados visuais:

| Estado | Visual |
|---|---|
| Verificando sessão | `RouteFallback` do guard, sem flash do formulário |
| Formulário | Card, dois campos, botão primário "Salvar nova senha" |
| Enviando | Botão desabilitado, rótulo "Salvando…", ícone `Loader2` com `aria-hidden` |
| Erro de campo | `FormMessage` abaixo do campo, borda `destructive` (padrão shadcn) |
| Erro do servidor | Alerta `role="alert"` acima do formulário, com foco |
| Sucesso | Toast e navegação. Sem tela intermediária |

Copy pt-BR (voz de interface, sem desculpa):

- Título: "Defina sua nova senha"
- Descrição: "Esta é sua primeira entrada. Troque a senha provisória para liberar o painel."
- Rótulos: "Nova senha" e "Confirmar nova senha"
- Ajuda do campo: "Use ao menos 8 caracteres."
- Botão: "Salvar nova senha"
- Validação (já no schema): "A senha deve ter ao menos 8 caracteres." e "As senhas não coincidem."

A tela não exibe a senha provisória, não cita "senha padrão" e não tem dica de login.

### 2.7 Login

`LoginPage` não muda. Nenhum aviso de "primeiro acesso" no login público, porque ele revelaria o comportamento do bootstrap.

### 2.8 Casos de borda

- **Recuperação de senha por e-mail com flag ligado.** `RedefinirSenhaPage` troca a senha mas não zera o flag. O usuário volta a `/trocar-senha`. Fail-closed. Assumido, ver §7.
- **Recuperação termina em `/app`.** Para super_admin com flag zerado, `/app` mostra a casca do tenant, porque `RequireActiveSubscription` deixa passar super_admin. Já era assim. Fora desta demanda, ver §7.
- **Falha entre as duas escritas da Edge Function.** A senha troca primeiro e o flag zera depois. Se a segunda falhar, o flag continua ligado e a tela pode repetir o envio. O estado é sempre fail-closed.
- **401 na submissão.** "Sua sessão expirou. Entre novamente." com link para `/login`. Sem logout silencioso.
- **Refresh em `/trocar-senha` depois da troca.** O profile foi invalidado, o flag veio `false`, a tela redireciona sem renderizar o formulário.
- **Duas abas.** A aba com o formulário recebe o profile atualizado no próximo foco ou submissão e redireciona.

## 3. Direção visual, design system e acessibilidade

### 3.1 Princípio

É um passo único e obrigatório. A pessoa precisa entender que ainda não pode entrar e saber o que falta. A personalidade é a da casca de auth que já existe: calma, direta e sem decoração. Uma tela mais expressiva competiria com a mensagem de bloqueio.

### 3.2 Tokens e layout

- Fundo, texto e card: tokens semânticos existentes (`background`, `foreground`, `card`, `muted-foreground`, `border`).
- Botão primário: `Button` default.
- Marcador de pendência: traço vertical à esquerda do card (`aria-hidden`) e chip "Primeiro acesso" com ícone de cadeado. Chip e traço usam `bg-status-pendente` e `text-status-pendente-foreground`, o mesmo par do status `pendente`. Esse é o único toque próprio da tela.
- Tipografia: título em `font-display` (Space Grotesk, já carregada), corpo em Inter. Nenhuma família nova.
- Espaçamento e raio: os do `AuthLayout` (`space-y-4` nos campos, `rounded-lg` do `Card`). Sem valor arbitrário.

Layout mobile-first:

```
Mobile (390px)                          Desktop (1280px)
┌──────────────────────────┐            ┌──────────────┬────────────────────┐
│ [Logo]            [tema] │            │ aside        │ [tema]             │
│ ┃ [cadeado] Primeiro     │            │ (destaques   │ ┃ [cadeado] Primeiro│
│ ┃ acesso                 │            │  do Auth-    │ ┃ Defina sua nova   │
│ ┃ Defina sua nova senha  │            │  Layout)     │ ┃ [Nova senha     ] │
│ ┃ [Nova senha        ]   │            │              │ ┃ [Confirmar      ] │
│ ┃ [Confirmar         ]   │            │              │ ┃ [Salvar nova    ] │
│ ┃ [Salvar nova senha ]   │            │              │ ┃ Sair              │
│ ┃ Sair                   │            │              │                    │
└──────────────────────────┘            └──────────────┴────────────────────┘
```

- Mobile: uma coluna, botão em largura total.
- Desktop: a aside do `AuthLayout` continua. Ela lista destaques do produto, que é ruído nesse momento. Trade-off aceito para não alterar o layout compartilhado. Se o QA julgar o ruído grave, a saída é uma prop `variant` no `AuthLayout`, em demanda separada.
- Card com `max-w-md`, o padrão do `AuthLayout`. Sem scroll horizontal em 390px.

Estados de componente: foco pelo `ring` do tema (sem sobrescrever `focus-visible`), botão desabilitado sem `opacity` manual, alerta com o bloco do `LoginPage` (`border-destructive/40 bg-destructive/10 text-destructive`). Nenhuma animação nova.

### 3.3 Erros da troca (mapeamento para pt-BR)

Função `mapInitialPasswordError(error)` em `src/lib/auth-errors.ts`, ao lado de `mapAuthError`. Não lança exceção.

| Causa (código do servidor) | Mensagem | Ação |
|---|---|---|
| 422 validação | "A senha deve ter ao menos 8 caracteres." | Fica na tela, foco no campo |
| 401 sessão inválida | "Sua sessão expirou. Entre novamente." com link para `/login` | Sem logout silencioso |
| 409 flag já zerado | Nenhuma mensagem. Invalida o profile e redireciona | Sucesso efetivo |
| 5xx ou rede | "Não foi possível salvar a nova senha. Tente novamente." | Fica na tela, botão reativado |

O erro técnico vai para `console.error` em inglês, sem corpo da requisição e sem senha. A mensagem do servidor nunca chega à tela.

### 3.4 Acessibilidade

- Cada campo tem `<label>` associado (`FormLabel` e `FormControl`). Placeholder não substitui rótulo.
- `FormDescription` ligado por `aria-describedby`, que o shadcn já faz.
- `autoComplete="new-password"` nos dois campos. `autoFocus` no primeiro campo, que é a única tarefa da tela.
- Ordem de tab: campo 1, campo 2, "Salvar nova senha", "Sair". Enter no campo 2 envia.
- Alerta de erro recebe foco (`tabIndex={-1}`, `ref.focus()`).
- Todo elemento interativo é `button`, `a` ou `input` nativo. Nenhuma armadilha de foco: a tela não é modal.

Contraste: a tabela a seguir foi calculada na rodada anterior, a partir dos tokens de `src/index.css`. Não foi recalculada nesta rodada. O QA mede os pares reais com o Chrome DevTools.

| Par (texto / fundo) | Claro | Escuro | Requisito | Situação |
|---|---|---|---|---|
| `foreground` / `background` | 16,84 | 16,72 | 4,5 | passa |
| `muted-foreground` / `background` | 5,52 | 7,46 | 4,5 | passa |
| `muted-foreground` / `card` | 5,65 | 6,75 | 4,5 | passa |
| `status-pendente-fg` / `status-pendente` (chip) | 5,98 | 7,91 | 4,5 | passa |
| `destructive` / `background` (texto do alerta) | 5,12 | 4,18 | 4,5 | escuro falha |
| `primary-foreground` / `primary` (botão) | 3,23 | 7,23 | 4,5 | claro falha |
| `ring` / `background` (foco) | 2,71 | 9,91 | 3,0 (1.4.11) | claro falha |
| `border` / `background` (contorno do campo) | 1,37 | 1,49 | 3,0 (1.4.11) | falha nos dois temas |

Os quatro pares que falham são tokens do app inteiro. Esta demanda não cria cor nova e não corrige tokens. A decisão fica em §7.

### 3.5 Movimento

Nenhuma animação própria. Nada a tratar em `prefers-reduced-motion` nesta tela.

## 4. Arquitetura React

| Camada | Itens |
|---|---|
| Componentes novos | `src/auth/TrocarSenhaPage.tsx`, `src/app/guards/RequirePasswordChange.tsx` |
| Componentes reusados | `Card*`, `Form*`, `Button`, `Input`, `SignOutButton`, `RouteFallback`, `DefensiveLogout`, `AccessDenied` |
| Hooks alterados | `useProfile` (campo e `fetchProfile`), `useCurrentUser` (`mustChangePassword`), `usePostLoginRedirect` (ordem nova e `fetchQuery`) |
| Hook de mutation novo | `useChangeInitialPassword` em `src/hooks/useAuthMutations.ts` |
| Função pura nova | `resolvePostLoginDestination` em `src/auth/` |
| Estado de servidor | `["profile", userId]` (única fonte do flag) e `["session"]` (já existe) |

Sem `fetch` solto em `useEffect`. O único `useEffect` novo é o foco do alerta, igual ao login.

Dados: o cliente do navegador usa anon key e a sessão do usuário. A RLS isola. Nenhum `tenant_id` é lido do cliente nem enviado como filtro. Nenhuma service role no bundle.

Senha no cliente: não entra em query key, cache, `localStorage` ou log. A mutation recebe a senha como argumento e não a guarda em estado. `form.reset()` roda antes da navegação. A senha provisória não aparece no código do frontend.

Ordem de avaliação no boot: `RequireAuth`, `RequirePasswordChange`, `RequireRole`, `RequireActiveSubscription` (só `/app`), página. Todos leem de `useCurrentUser`, que lê de uma única query com cache.

## 5. Dependências de dados e backend

Cada item abaixo é fora do frontend, mas sem ele a tela não fecha a segurança.

**Já na base (não refazer):**

- **D1. Flag e guard de colunas.** `profiles.must_change_password` e o trigger de bloqueio de escrita do cliente (`20250228090000`, `091500`, `091700`). O cliente não consegue alterar `role`, `tenant_id` nem o flag.
- **D2. Bloqueio RLS.** As policies cross-tenant do super_admin exigem `not current_must_change_password()` (`20250228091800`). Com o flag ligado, o super_admin lê zero linhas de outras empresas, mesmo pelo PostgREST direto.

**Pendentes, a criar:**

- **D3. Edge Function `trocar-senha-inicial`.** Molde: `supabase/functions/admin-subscription/index.ts` (identidade pelo JWT, service client, CORS, respostas JSON em pt-BR).
  - Identidade pelo `auth.getUser(token)`. Nunca pelo corpo.
  - Corpo validado com zod: `{ password: string }`, 8 a 72 bytes (limite do bcrypt no GoTrue). Chaves extras são rejeitadas.
  - Se o profile não tiver o flag ligado: 409.
  - Ordem: (a) `auth.admin.updateUserById(userId, { password })`; (b) `update profiles set must_change_password = false, password_changed_at = now() where id = userId and must_change_password = true`. Com (a) feito e (b) falho, o flag segue ligado (fail-closed).
  - O flag não é zerado sem a troca de senha. Por isso as duas escritas ficam na mesma função, executada com service role.
  - Logs técnicos em inglês, sem senha, sem e-mail e sem corpo da requisição. Resposta `{ ok: true }`.
- **D4. Checagem do flag em `admin-subscription`.** Recusar com 403 e código `password_change_required` quando o flag estiver ligado. A UI não depende disso para navegar, mas a defesa vale para chamada direta.
- **D5. Novo mecanismo de criação do super_admin.**
  - Remover `public.bootstrap_super_admin` e as migrations `20250228092000` a `20250228092300` por uma migration nova, com `drop function`. Não editar as migrations aplicadas.
  - Migration nova que substitui `handle_new_user`. O corpo vigente está em `20250225091000` (seed de templates por ramo) e deve ser copiado de lá, sem regredir. O novo ramo: se `new.raw_app_meta_data->>'bootstrap_role' = 'super_admin'`, criar apenas `profiles` com `role = 'super_admin'`, `tenant_id = null` e `must_change_password = true`, sem tenant e sem seed de templates. Qualquer outro caso segue o comportamento atual.
  - `raw_app_meta_data` é escrito só pelo servidor. `raw_user_meta_data` é do usuário, então não serve como marcador.
  - Seed idempotente com service role, que cria o usuário `admin@neox.com.br` com `app_metadata: { bootstrap_role: 'super_admin' }` e e-mail confirmado. Se o e-mail já existir, não recria e não troca a senha. O literal da senha provisória fica só no backend, com comentário "provisória, trocar antes do beta". O seed não imprime a senha em log.

Sem dependência de dados em `src/router.tsx`. A rota e os guards são só frontend.

## 6. Arquivos afetados

Alterados no frontend:

- `src/types/domain.ts`: `CurrentProfile` ganha `must_change_password: boolean`.
- `src/hooks/useProfile.ts`: `select`, schema zod e `fetchProfile` exportado.
- `src/hooks/useCurrentUser.ts`: campo `mustChangePassword`.
- `src/auth/usePostLoginRedirect.ts`: ordem nova, `fetchQuery` e `resolvePostLoginDestination`.
- `src/auth/pages.tsx`: exporta `TrocarSenhaPage`.
- `src/hooks/useAuthMutations.ts`: `useChangeInitialPassword`.
- `src/lib/auth-errors.ts`: `mapInitialPasswordError`.
- `src/router.tsx`: rota `/trocar-senha`, `RequirePasswordChange` nas árvores `/app` e `/admin`, índice de `/admin` como redirect para `/admin/empresas`.

Criados no frontend:

- `src/auth/TrocarSenhaPage.tsx`
- `src/app/guards/RequirePasswordChange.tsx`
- `src/auth/resolvePostLoginDestination.ts`
- Testes unitários (§8).

Backend (rastreio): migration de remoção do bootstrap por conversão, migration de `handle_new_user` com o ramo `bootstrap_role`, Edge Function `trocar-senha-inicial`, ajuste em `admin-subscription`, seed do super_admin.

Não alterados: `LoginPage`, `RedefinirSenhaPage`, `AuthLayout`, `AdminLayout`, `EmpresasPage`, `src/index.css`, `tailwind.config.ts`, `src/components/ui/*`.

## 7. Dúvidas e riscos

1. **Contraste (decisão do usuário).** Quatro pares falham no app inteiro (§3.4). Corrigir é mudar tokens em `src/index.css`, o que altera todas as telas. Pergunta: abrir demanda separada de tokens, ou aceitar os pares nesta entrega?
2. **Flag para todos os papéis.** Assumido: o mecanismo é genérico (qualquer profile pode ter o flag) e o guard vale em `/app` e `/admin`. Se o usuário quiser restringir ao super_admin, o guard fica igual, e o redirect ganha checagem de papel.
3. **Recuperação de senha não zera o flag.** Assumido como fail-closed. A troca forçada é a regra do bootstrap.
4. **Super_admin cai na casca de tenant depois da recuperação de senha.** Comportamento anterior, fora desta demanda. Sinalizado para demanda própria.
5. **Senha fixa.** Aceita pelo usuário até o beta. O literal fica no repositório porque a migration e o seed rodam em todos os ambientes. Antes do beta, trocar por senha gerada por ambiente.
6. **Risco de regressão no `handle_new_user`.** A nova migration recria a função inteira. Se o corpo copiado não bater com o vigente (`20250225091000`), o cadastro de empresas quebra. A migration deve ser testada com um cadastro normal no `supabase db reset`.

## 8. Testabilidade e critério de aceite visual

### 8.1 Testes

Unitários (vitest, sem rede):

- `resolvePostLoginDestination`: flag ligado com `from` leva a `/trocar-senha`. Flag desligado com `from` leva a `from`. `super_admin` sem `from` leva a `/admin/empresas`. `super_admin` com `from=/admin` leva a `/admin/empresas`. Admin de tenant leva a `/app`. Erro leva a `/app`.
- `mapInitialPasswordError`: 422, 401, 409, 5xx e rede mapeiam para as mensagens da §3.3. Nenhum texto bruto do servidor aparece.
- `useProfile` (zod): aceita `must_change_password` booleano e rejeita a ausência do campo.

Integração (banco, `supabase db reset`):

- Cliente autenticado não consegue `update profiles set must_change_password = false` (42501).
- Cliente autenticado não consegue alterar `role` nem `tenant_id` (42501).
- Super_admin com flag ligado lê zero linhas de `tenants` de outras empresas. Com flag zerado, lê.
- `trocar-senha-inicial`: 401 sem JWT, 409 com flag zerado, 200 com flag ligado, e o flag fica zerado depois.
- Seed do super_admin: duas execuções não criam segundo usuário nem trocam a senha existente.
- `handle_new_user`: signup comum cria tenant e profile admin como antes. Usuário com `bootstrap_role` cria profile super_admin com `tenant_id` nulo e nenhum tenant novo.

### 8.2 Critério de aceite visual (QA por ADR, Chrome DevTools)

Pré-condição: `supabase db reset`, seed do super_admin executado, app servido em `127.0.0.1`.

Fluxo, repetido em 390px e 1280px, claro e escuro:

1. `/admin/empresas` sem sessão redireciona para `/login`.
2. Login com `admin@neox.com.br` e a senha provisória leva a `/trocar-senha`. Título "Defina sua nova senha" visível. Nenhum texto de `EmpresasPage` no DOM.
3. `/admin/empresas` digitado na barra de endereço permanece em `/trocar-senha`. A tabela não renderiza.
4. Senhas diferentes: "As senhas não coincidem." abaixo de "Confirmar nova senha".
5. Senha com 5 caracteres: "A senha deve ter ao menos 8 caracteres.".
6. Senha válida e igual: toast "Senha atualizada. Painel liberado." e URL `/admin/empresas`.
7. Recarregar mantém `/admin/empresas`. Abrir `/trocar-senha` redireciona para `/admin/empresas`.
8. `/admin` vai para `/admin/empresas`.
9. Sair e entrar com a senha nova leva a `/admin/empresas`. Com a senha provisória, mostra "E-mail ou senha incorretos.".
10. Usuário de tenant (admin) faz login e chega em `/app` sem passar por `/trocar-senha`.

Técnico e visual:

- Console sem erro nem aviso em nenhum passo (`list_console_messages`).
- Resposta da troca não contém a senha nem o hash. É `{ ok: true }` ou o erro mapeado.
- `grep` da senha provisória em `dist/` retorna zero resultados.
- 390px: `scrollWidth <= clientWidth`. Botão em largura total.
- 1280px: aside do `AuthLayout` visível, card centralizado.
- Contraste medido com DevTools (cor computada do texto e do fundo efetivo) nos pares da §3.4.
- Teclado: ordem da §3.4, Enter envia, foco visível em todos os elementos.
- Screenshot de referência para cada combinação (390 e 1280, claro e escuro).

## 9. Respostas a achados de revisão

Não há revisão de design anterior para esta rodada. Nada a responder.
