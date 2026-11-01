# Design de frontend: troca de senha com Edge Function e papel no JWT

Status: design de frontend. Sem código de aplicação.
Base: `feat/adr-01-password-gate`.
Substitui o desenho anterior de senha (ADR-04 a ADR-10). O documento anterior foi preservado em `analysis-frontend.anterior-senha-adr04-10.md`.

## 1. Visão geral

A demanda toca tela. Estas telas e comportamentos mudam:

- `/login`: após o login, o destino sai das claims do token, sem consulta extra.
- `/trocar-senha` (nova): o único lugar onde o super admin pode ir enquanto o flag estiver ligado.
- Guards de `/app` e `/admin`: um guard novo bloqueia a área até a troca.
- `/admin` (índice): redireciona para `/admin/empresas`.

Mudança central: o frontend deixa de ler `profiles` para identidade. Papel, tenant e flag de troca vêm das claims do access token, emitidas pelo custom access token hook. A cadeia de leitura cai de sessão, profile e tenant para sessão e tenant. Sessão e claims são locais, sem rede, então o cold start de `/app` perde uma ida ao servidor (ajuda RNF01).

O flag `must_change_password` fica em `app_metadata`, gravado só pelo service role. O cliente lê. O cliente nunca escreve papel, tenant ou flag.

Fora do escopo deste documento: RLS de dados do tenant, `admin-subscription`, `EmpresasPage`, marketing e `AuthLayout` (sem mudança).

## 2. Contrato de identidade (claims do JWT)

O custom access token hook emite três claims no nível de topo do access token:

| Claim | Tipo | Origem no banco |
|---|---|---|
| `user_role` | enum `super_admin \| admin \| professional \| receptionist` | `profiles.role` |
| `tenant_id` | uuid ou `null` (super_admin) | `profiles.tenant_id` |
| `must_change_password` | boolean, obrigatório | `app_metadata.must_change_password` (default `false`) |

Nome `user_role` no lugar de `role`: o PostgREST usa a claim `role` para escolher o papel do Postgres. Se o hook sobrescrever `role`, o RLS de todas as tabelas quebra. O hook não emite `role`.

Leitura no cliente:

- `src/lib/auth-claims.ts` expõe `parseAuthClaims(accessToken): AuthClaims | null`. Decodifica o payload (base64url com `atob`) e valida com zod. Retorna `null` para token malformado, claim ausente, enum fora da lista ou `must_change_password` que não seja boolean. Não lança.
- `src/hooks/useAuthClaims.ts` deriva as claims de `useSession()` com `useMemo`. Não cria query nem chamada de rede.
- Decodificar no cliente não é fronteira de segurança. A assinatura é verificada pelo GoTrue, e a fronteira real são o RLS e a Edge Function. O cliente usa a claim para rotear e esconder controles.
- Nunca ler `user_metadata` para papel, tenant ou flag. O usuário altera o próprio `user_metadata` com `updateUser({ data })`. O cadastro já grava `trade_name` e `segment` ali, e isso continua como está.
- Sessão viva com claims inválidas (token antigo, de antes do hook, ou hook desligado) é erro de identidade. Os guards chamam `DefensiveLogout`, que encerra a sessão e manda para `/login`. Quem tinha sessão antiga entra de novo uma vez. Esse é o comportamento fail-closed.

Claim defasada: depois da troca, o access token atual ainda traz `must_change_password: true` até ser renovado. Por isso a tela termina com `supabase.auth.refreshSession()` e decide o destino com as claims do token novo (seção 4.4).

Validade: papel revogado pode aparecer na UI até o token expirar (`jwt_expiry = 3600` em `config.toml`). Os dados continuam protegidos pelo RLS. Aceito.

## 3. Rotas e guards

Mapa de rotas:

```
/login, /cadastro, /recuperar-senha, /redefinir-senha   AuthLayout (público, sem mudança)
/trocar-senha   (NOVO)   GateLayout → RequireAuth → TrocarSenhaPage
/admin                    RequireAuth → RequirePasswordChange (NOVO)
                            → RequireRole(["super_admin"]) → AdminLayout
                            → índice: <Navigate to="/admin/empresas" replace />
/admin/empresas           mesma cadeia → EmpresasPage
/app/*                    RequireAuth → RequirePasswordChange (NOVO)
                            → RequireActiveSubscription → AppLayout (demais rotas sem mudança)
```

Decisões:

- Ordem fixa: sessão, troca de senha, papel, assinatura. A troca vem antes do papel, para que quem tem o flag ligado não veja a tela de acesso negado de outra área.
- `RequirePasswordChange` entra nas duas árvores. O flag é do usuário, não do papel. Um guard só em `/admin` deixaria uma conta de tenant com o flag ligado entrar no app. Hoje nenhuma conta de tenant tem o flag ligado, então o custo é zero.
- `/trocar-senha` fica fora do `RequirePasswordChange`. Dentro dele, o guard mandaria a rota para ela mesma em loop.
- `/admin` índice redireciona para `/admin/empresas`. Nenhum caminho leva ao placeholder `AdminDashboardPage`, nem um `from` preservado no login. O componente fica no arquivo, sem rota.
- Não preservar `from` depois da troca. A tela volta para o destino do papel. Assim o usuário não cai em uma página antiga com permissão de antes.

Decisão pura do guard, em `src/auth/passwordGate.ts`:

```
decidePasswordGate({ isLoadingAuth, isAuthenticated, hasIdentityError, mustChangePassword })
  → "loading" | "anonymous" | "identity-error" | "change-password" | "allow"
```

Os componentes de guard só traduzem o resultado em `RouteFallback`, `Navigate`, `DefensiveLogout` ou `Outlet`.

Estados por guard:

| Estado | Resultado |
|---|---|
| Carregando identidade ou tenant | `RouteFallback` |
| Sem sessão | `/login` com `state.from` |
| Sessão sem claims válidas, ou tenant ilegível | `DefensiveLogout` |
| `must_change_password = true` | `/trocar-senha` |
| Papel fora de `roles` (RequireRole) | `AccessDenied` |
| `bloqueado` | `/app/quitacao` |
| `cancelado` | `ContaCanceladaPage` |

`from` vira string. Hoje `RequireAuth` grava o objeto `Location` em `state.from`, e `LoginPage` tipa o valor como string. Os guards passam a gravar `pathname + search` como string, e a função `resolvePostLoginDestination` recebe string.

## 4. Tela `/trocar-senha`

### 4.1 Layout

Nova casca `src/auth/GateLayout.tsx`: cabeçalho com `Logo` e `ThemeToggle` (ambos reusados) e um centro com a página. Sem a aside de `AuthLayout`. A aside lista funcionalidades do produto para visitante. Quem cai nesta tela já tem conta e precisa de uma tarefa só. `AuthLayout` continua igual.

Mobile, 390 px:

```
┌──────────────────────────────┐
│ [logo]                 [tema]│
│                              │
│ ┃ [🔒 Primeiro acesso]       │  ┃ = trilho âmbar (status-pendente)
│ ┃ Crie sua nova senha        │
│ ┃ Sua senha atual é          │
│ ┃ provisória. Defina uma     │
│ ┃ senha só sua.              │
│ ┃ admin@neox.com.br (mono)   │
│ ┃                            │
│ ┃ Nova senha                 │
│ ┃ [••••••••••••••••••]       │
│ ┃ Use ao menos 8 caracteres. │
│ ┃ Confirmar nova senha       │
│ ┃ [••••••••••••••••••]       │
│ ┃ [   Salvar nova senha    ] │  largura total, 44 px de altura
│ ┃            Sair            │
└──────────────────────────────┘
```

Desktop, 1280 px: a mesma coluna centralizada, largura máxima 28rem (`max-w-md`), sem aside, sobre o fundo `background`.

### 4.2 Conteúdo (pt-BR)

- Selo: "Primeiro acesso".
- Título: "Crie sua nova senha".
- Descrição: "Sua senha atual é provisória. Defina uma senha só sua para entrar no painel."
- Conta: e-mail de `session.user.email`, em JetBrains Mono. Confirma para o usuário qual conta está trocando a senha.
- Campos: "Nova senha" (ajuda: "Use ao menos 8 caracteres.") e "Confirmar nova senha".
- Botão: "Salvar nova senha". Durante o envio: "Salvando…".
- Link de saída: "Sair".
- Sucesso (toast): "Senha salva. Painel liberado."

Erros:

| Origem | Texto | Foco e ação |
|---|---|---|
| Validação local | "A senha deve ter ao menos 8 caracteres." / "As senhas não coincidem." | Campo, `aria-invalid` |
| Validação local | "A senha deve ter no máximo 72 caracteres." (72 bytes UTF-8) | Campo |
| 400 `password_is_initial` | "Escolha uma senha diferente da atual." | Campo |
| 400 `invalid_body`, 500, rede | "Não foi possível salvar a nova senha. Tente novamente." | Alerta, botão reativado |
| 401, de qualquer origem (inclui o 401 do gateway) | "Sua sessão expirou. Entre novamente." | Alerta com link para `/login` |

O 409 `password_change_not_required` não mostra erro. A tela trata como sucesso (seção 4.4). Os códigos `password_change_in_progress` e `password_change_superseded` do desenho anterior saem. Com "última escrita vence", não há reserva.

Mensagem do servidor nunca vai para a tela. A tela só mostra os textos acima.

### 4.3 Botão durante a chamada

- `disabled={mutation.isPending}` no botão "Salvar nova senha".
- `onSubmit` começa com `if (mutation.isPending) return`. Cobre o Enter dado antes de o React renderizar o estado pendente.
- Enquanto pendente: ícone de carregamento com `aria-hidden`, rótulo "Salvando…" e um `<span role="status" className="sr-only">Salvando nova senha</span>`.
- Campos e o link "Sair" continuam ativos. Só o botão de troca é desabilitado, como pedido.
- Sem reserva e sem lock no banco. Duas abas enviando juntas: ambas recebem 200 e a última senha gravada vale.

### 4.4 Fluxo de sucesso e de falha da renovação

1. `mutationFn` chama `supabase.functions.invoke("change-password", { body: { password } })`.
2. Em 200 ou 409 `password_change_not_required`, a página chama `supabase.auth.refreshSession()`.
3. Se a renovação der certo e as claims novas tiverem `must_change_password === false`: `form.reset()`, toast de sucesso e `navigate(resolvePostLoginDestination(claims), { replace: true })`. Para super admin, o destino é `/admin/empresas`.
4. Se a renovação falhar, ou se as claims novas ainda vierem com o flag ligado: `signOut` local e `navigate("/login", { replace: true })` com aviso "Senha salva. Entre com a nova senha.". O estado seguro é sair. A tela nunca libera o painel com token defasado.

Senha e cache: a senha só existe nas variáveis da mutation. Depois do sucesso, a página chama `mutation.reset()`. `useMutation` usa `gcTime: 0`, então a mutation sai do cache quando a tela desmonta. A senha não entra em query key nem em `localStorage`, e não é logada.

### 4.5 Acesso direto

- Sem sessão: `RequireAuth` manda para `/login`.
- Flag desligado ao montar (outra aba já trocou, por exemplo): `<Navigate>` para o destino do papel.

## 5. Direção visual e design system

Direção: o painel de operação calmo já definido em `index.css` (ardósia, azul-noite e acento jade). Esta tela é um portão: uma tarefa só, sem distração.

Plano de tokens (frontend-design, pass 1):

- Paleta: os tokens existentes. Fundo `background` (`222 24% 9%` no escuro), superfície `card` (`222 20% 13%`), texto `foreground` (`210 20% 96%`), acento `primary` (jade) e âmbar `status-pendente` (`38 92% 55%` no escuro, `38 92% 45%` no claro). Não há cor nova.
- Tipografia: Space Grotesk 600 no título (`font-display`, `text-2xl`). Inter em corpo, labels e ajuda. JetBrains Mono só no e-mail da conta. Ajuda de campo em `text-xs`, o mínimo legível.
- Inputs no mobile com `text-base sm:text-sm`. Abaixo de 16 px, o iOS amplia a tela ao focar o campo.
- Layout: coluna única, `max-w-md`, padding horizontal de 16 px no mobile.
- Assinatura da tela: um trilho vertical de 4 px na borda esquerda do card, na cor `status-pendente`, e o selo "Primeiro acesso" com a mesma cor. Esse é o único toque próprio da tela. O trilho diz que a conta está em estado bloqueante. Ele reusa o token que os badges de status do painel já usam.
- Descartado: numeração de passos ("1 de 2"), porque a troca é uma ação só. Descartados também: ilustração, gradiente, animação de entrada.
- Movimento: nenhuma animação de entrada. O spinner e a transição do foco já existem. `prefers-reduced-motion` já está no CSS global.

Tokens alterados (única mudança de cor, validada na seção 6):

| Token | Antes | Depois | Tema |
|---|---|---|---|
| `--primary` | `160 64% 38%` | `160 64% 31%` | claro |
| `--ring` | `160 64% 42%` | `160 64% 36%` | claro |
| `--input` | `214 20% 86%` | `215 16% 56%` | claro |
| `--input` | `222 15% 22%` | `222 15% 46%` | escuro |

Os valores de `--destructive` ficam como estão. O alerta de erro usa texto na cor `foreground`, com borda e ícone na cor `destructive`. Assim não é preciso mexer no token de destrutivo, que também pinta botões de exclusão em todo o app.

Componentes reusados de `src/components` e `src/components/ui`, sem recriar:

- `Card` (`CardHeader`, `CardTitle`, `CardDescription`, `CardContent`), `Form`, `FormField`, `FormItem`, `FormLabel`, `FormControl`, `FormDescription`, `FormMessage`, `Input`, `Button`, `Badge` (com `className` de `bg-status-pendente text-status-pendente-foreground`).
- `Logo`, `ThemeToggle`, `SignOutButton` (variante `ghost`, rótulo "Sair"), `RouteFallback`, `toast` do `sonner`.
- Alerta de erro: o mesmo padrão de `LoginPage`, um `<p role="alert" tabIndex={-1}>`. Não existe primitivo de alerta em `ui/`, e um primitivo novo só se justifica quando o padrão aparecer em três telas.
- Novo: só `GateLayout` (composição) e `initialPasswordSchema` (validação).

Estados visuais:

- Padrão, foco (anel `ring` com `ring-offset-2`), erro de campo (`FormMessage` em `destructive`), erro de servidor (alerta com borda e ícone `destructive`), enviando (botão com `opacity-50`, o estado `disabled` padrão do shadcn), sucesso (toast).

Badges de status: o selo "Primeiro acesso" é o único badge novo. Os badges de assinatura de `EmpresasPage` não mudam.

## 6. Acessibilidade (WCAG 2.2 AA)

Razões de contraste calculadas com a fórmula WCAG a partir dos valores HSL de `index.css` e de `tailwind.config.ts`. Os valores "depois" são os da seção 5.

| Par | Tema | Antes | Depois | Mínimo |
|---|---|---|---|---|
| Texto `foreground` / `card` | claro | 17,22 | 17,22 | 4,5 |
| Texto `muted-foreground` / `card` | claro | 5,65 | 5,65 | 4,5 |
| Texto `primary-foreground` / botão `primary` | claro | 3,23 (falha) | 4,62 | 4,5 |
| Link `primary` / `card` | claro | 3,34 (falha) | 4,78 | 4,5 |
| Anel `ring` / `background` | claro | 2,71 (falha) | 3,61 | 3 (não textual) |
| Borda `input` / `card` | claro | 1,40 (falha) | 3,43 | 3 (1.4.11) |
| Texto `foreground` sobre fundo do alerta (destructive a 10%) | claro | não medido, texto em `destructive` seria 4,46 | 14,69 | 4,5 |
| Ícone `destructive` / `card` | claro | 5,24 | 5,24 | 3 |
| Texto `primary` / `card` | escuro | 6,85 | 6,85 | 4,5 |
| Anel `ring` / `background` | escuro | 9,91 | 9,91 | 3 |
| Borda `input` / `card` | escuro | 1,35 (falha) | 3,26 | 3 (1.4.11) |
| Texto `foreground` sobre fundo do alerta | escuro | não medido, texto em `destructive` seria 3,50 | 14,00 | 4,5 |
| Ícone `destructive` / `card` | escuro | 3,78 | 3,78 | 3 |

O par "texto destrutivo" do alerta falhava (3,50 no escuro). A solução de texto em `foreground` evita mexer no token. Os pares de `status-pendente` (chip) passam nos dois temas: 5,98 no claro e 7,91 no escuro.

Demais requisitos:

- Labels: `FormLabel` já associa o `htmlFor` ao campo. A ajuda usa `FormDescription`, ligada por `aria-describedby`. Erro de campo usa `aria-invalid` (`FormControl`).
- Foco inicial no primeiro campo. A tela tem uma tarefa só, então o foco inicial ajuda.
- Ordem de tabulação: campo 1, campo 2, "Salvar nova senha", "Sair". Enter envia.
- Erro de servidor: `role="alert"` e foco no alerta, como em `LoginPage`.
- Alvo de toque: botão de 44 px de altura no mobile (`h-11 sm:h-10`).
- Reflow: nenhuma rolagem horizontal em 320 CSS px.
- Movimento reduzido já é tratado no CSS global.

## 7. Arquitetura React

Camadas:

- Estado de servidor (TanStack Query): sessão (`useSession`, chave `["session"]`, alimentada pelo `AuthListener`), tenant (`["tenant", tenantId]`), mutation de login (existente) e mutation `useChangeInitialPassword`.
- Derivado, sem estado próprio: `useAuthClaims` (sobre a sessão) e `useCurrentUser` (agregador de claims e tenant). `usePermissions` mantém a mesma API.
- Funções puras, testáveis sem React: `parseAuthClaims`, `resolvePostLoginDestination`, `decidePasswordGate`, `mapInitialPasswordError`.
- Componentes: páginas e guards. Nenhum `fetch` solto em `useEffect`.

Mudanças nos consumidores de `useProfile`, que sai do código:

- `useTenant`: usa `tenantId` das claims, não de `profiles`. O `select` de `tenants` continua sob RLS.
- `useEffectiveProfessionalId` e `DashboardPage`: usam `userId` (de `session.user.id`, igual a `auth.uid()`), não `profile.id`.
- `usePostLoginRedirect`: recebe a sessão devolvida por `signInWithPassword` e decide o destino sem rede. Ordem das regras: flag ligado primeiro, depois `from`, depois papel.
- `CurrentUser` ganha `userId`, `tenantId` e `mustChangePassword`. `hasProfileError` vira `hasIdentityError` (claims inválidas ou ausentes).

Supabase no navegador: cliente de `src/lib/supabase.ts` com a anon key e a sessão do usuário. `functions.invoke` anexa o JWT do usuário sozinho. Nenhuma chave de serviço entra no bundle. Nenhum `tenant_id` sai do cliente.

Formulários: `react-hook-form` com `zodResolver`. Na tela de troca, o schema é `initialPasswordSchema`, novo em `src/lib/validations/auth.ts`. Ele valida mínimo de 8 caracteres, máximo de 72 bytes UTF-8 (`TextEncoder`) e confirmação igual. `resetPasswordSchema` fica como está, para a recuperação de senha.

Erros: `mapInitialPasswordError(error)` em `src/lib/auth-errors.ts`, sem lançar. Lê o status HTTP. Para 401, retorna sessão expirada, sem depender do corpo. Para os demais casos, lê `code` do corpo quando for JSON válido. Qualquer outra coisa cai no texto genérico.

## 8. Segurança no cliente

- O cliente só envia `{ password }` para `change-password`. Não envia `role`, `tenant_id`, flag nem id do usuário.
- A aplicação não escreve em `profiles` em nenhum caminho. O acceptance verifica com `grep`.
- `user_metadata` nunca decide papel, tenant nem flag.
- A senha provisória não aparece no bundle nem em texto da tela. A tela não mostra dica de senha.
- `updateUser({ password })` continua na recuperação de senha. Esse caminho não limpa o flag. Ver R3.

## 9. Dependências de dados e backend

A frente de backend entrega estas peças. A tela depende delas para funcionar, e a lista é a única fonte de dependência deste documento.

| # | Peça | Estado na base | Consumidor no frontend |
|---|---|---|---|
| D1 | Custom access token hook que emite `user_role`, `tenant_id` e `must_change_password` (copiado de `app_metadata`, default `false`) e não emite `role` | Não existe | Toda a identidade (`useAuthClaims`) |
| D2 | Edge Function `change-password`: POST, JWT do usuário, corpo `{ password }`. Ordem: gravar a senha no Auth com service role, depois gravar `must_change_password: false` no `app_metadata`, preservando as outras chaves. Respostas: 200; 400 `invalid_body`, `password_too_short`, `password_too_long`, `password_is_initial`; 401 `unauthenticated`; 409 `password_change_not_required`; 500 `internal_error` | Não existe | Tela `/trocar-senha` |
| D3 | Bootstrap idempotente com service role: cria `admin@neox.com.br` com senha provisória, `app_metadata` com flag ligado e perfil `super_admin` sem tenant. Não tem tela | Não existe | Login inicial (sem tela própria) |
| D4 | Migração de limpeza: remover `current_must_change_password()`, reverter as policies `tenants_super_admin_select`, `tenants_super_admin_update_cadastro`, `subscription_status_changes_super_admin` e `profiles_super_admin` para a forma sem flag, remover `profiles.must_change_password`, `password_changed_at`, reserva de troca e função de bootstrap antiga. As migrações aplicadas não são editadas. | Pendente | Remove o uso de flag no banco |

Conflito com desenhos já aplicados: as ADRs 01 a 03 colocam o flag em `profiles` e em policies de RLS. O desenho novo tira o flag de `profiles` e não usa flag em RLS. A frente de dados precisa decidir o que sobra das ADRs 01 a 03 e o que entra na limpeza (D4).

Tabelas consultadas pelo frontend e que continuam sob RLS: `tenants` (assinatura, para o guard de assinatura) e as tabelas operacionais. Nenhuma delas muda por causa desta demanda.

## 10. Riscos e decisões que o usuário precisa aceitar

R1. Senha provisória fixa e conhecida, mais leitura cross-tenant do super admin pelo banco. Quem souber a senha antes da troca consegue ler as empresas direto pelo PostgREST, porque o bloqueio de `/trocar-senha` é só de UI. Não existe correção pelo frontend. Duas saídas: (a) aceitar até o beta, com troca obrigatória e rotação antes de dados reais; (b) rodar o bootstrap com senha fixa só em ambiente local ou de desenvolvimento. Não é aceitável usar o flag dentro de uma policy de RLS, porque o desenho proíbe policy que muda com o flag. Recomendação: (a) e (b) juntas.

R2. A troca não encerra as outras sessões do usuário. Uma sessão aberta com a senha provisória continua válida depois da troca. Recomendação: a Edge `change-password` encerra as outras sessões depois de gravar a senha (`signOut(userId, "others")` com service role). Efeito no frontend: outras abas caem na renovação e vão para `/login`, o que já é o comportamento da seção 4.4.

R3. Recuperação de senha por `updateUser` não limpa o flag. Quem esquece a senha antes da primeira troca volta para `/trocar-senha` depois de recuperar. Fail-closed, aceito.

R4. Claims defasadas por até 1 hora (`jwt_expiry`). Papel revogado aparece na UI até o token expirar. O RLS nega os dados. Aceito.

## 11. Impacto nas ADRs de frontend 11 a 15

| ADR | Mudança |
|---|---|
| 11 | Remove `useProfile` e `fetchProfile`. Cria `auth-claims.ts` e `useAuthClaims`. `resolvePostLoginDestination({ role, mustChangePassword, from })` mantém as regras, com as entradas vindas das claims. `CurrentUser` ganha os campos da seção 7. |
| 12 | `usePostLoginRedirect` não lê o banco. Recebe a sessão do login e chama `resolvePostLoginDestination`. A ordem de regras (flag antes de `from`) continua. O teste "não chama `from("profiles")`" sai, porque a chamada deixa de existir. |
| 13 | A mutation chama `change-password` com `{ password }`. O mapeamento perde `in_progress` e `superseded` e trata 401 de qualquer origem. Sucesso chama `refreshSession`. `gcTime: 0`. |
| 14 | `TrocarSenhaPage` fica em `GateLayout`, sem aside. Usa `initialPasswordSchema`. Botão desabilitado com guarda no `onSubmit`. O teste de DOM sai (ver seção 12). |
| 15 | `RequirePasswordChange` entra em `/app` e `/admin`. `/admin` índice redireciona. Ganha o roteiro da seção 13. Guards passam a usar `from` como string. |

## 12. Testabilidade

- Unitários (vitest, ambiente `node`, sem DOM), todos sobre funções puras: `parseAuthClaims` (token válido, claim ausente, enum inválido, flag como string `"true"` rejeitado, base64 inválido), `resolvePostLoginDestination` (tabela de casos), `decidePasswordGate` (cada estado da tabela da seção 3), `mapInitialPasswordError` (cada linha da tabela de erros), `initialPasswordSchema` (8 caracteres, 72 bytes com acento, confirmação).
- Sem jsdom nem testing-library. A stack não os tem, e adicioná-los só para esta tela amplia dependências. Comportamento de DOM (botão desabilitado, foco, navegação, texto na tela) entra no QA visual com Chrome DevTools (seção 13).
- Integração: claims emitidas pelo hook, flag limpo, respostas 401, 409 e 400 da Edge. Fica na suíte da frente de backend.

## 13. Critério de aceite visual (QA com Chrome DevTools)

Rodar nos quatro cenários: 390 × 844 e 1280 × 800, tema claro e escuro. Cada cenário gera screenshot e medição.

1. Login do super admin com a senha provisória cai em `/trocar-senha`. O `take_snapshot` não mostra itens de `EmpresasPage`. Acesso direto a `/app/agenda` também redireciona para `/trocar-senha`.
2. Dois cliques rápidos em "Salvar nova senha" geram uma única requisição a `change-password` (`list_network_requests`). Durante a chamada, `button.disabled === true`.
3. Após 200, a página renova o token (`/auth/v1/token?grant_type=refresh_token`) e navega para `/admin/empresas`. Voltar para `/trocar-senha` redireciona de novo para `/admin/empresas`.
4. Sair e entrar de novo leva direto a `/admin/empresas`.
5. Login de admin de tenant leva a `/app` sem passar por `/trocar-senha`.
6. Senha de 7 caracteres mostra o erro no campo, com `aria-invalid="true"`, e o foco vai para o campo.
7. Resposta 401 mostra "Sua sessão expirou. Entre novamente." com o link para `/login`.
8. Rede desligada mostra o texto genérico e reativa o botão.
9. Contraste: `getComputedStyle` confirma os valores da seção 6, com o mínimo de cada par.
10. Mobile 390 px: `scrollWidth <= clientWidth`, botão com a largura do card, input com `font-size >= 16px`, altura do botão `>= 44px`.
11. Teclado: ordem de tabulação da seção 6, Enter envia, anel de foco visível em todos os controles.
12. Console sem erro nem aviso em todos os passos (`list_console_messages`).
13. Resposta de `change-password` não contém senha, hash, chave de serviço nem o nome do marcador (`get_network_request`).
14. `npm run build` gera `dist/`, e `grep` da senha provisória em `dist/` retorna zero resultados.
15. Cold start de `/app` (tenant de admin): nenhuma requisição a `/rest/v1/profiles` (`list_network_requests`). A tela de agenda carrega em menos de 1,5 s (RNF01), medido com `performance_start_trace`.
16. `grep -rn 'from("profiles")' src` retorna zero resultados.
17. `npm run typecheck` e `npm test` passam.

## 14. Arquivos afetados (frontend)

Criar:
- `src/lib/auth-claims.ts` e `src/lib/auth-claims.test.ts`
- `src/hooks/useAuthClaims.ts`
- `src/auth/resolvePostLoginDestination.ts` e `.test.ts`
- `src/auth/passwordGate.ts` e `.test.ts`
- `src/auth/TrocarSenhaPage.tsx`
- `src/auth/GateLayout.tsx`
- `src/app/guards/RequirePasswordChange.tsx`

Editar:
- `src/hooks/useCurrentUser.ts`, `src/hooks/useTenant.ts`, `src/hooks/useEffectiveProfessionalId.ts`, `src/hooks/useAuthMutations.ts` (inclui `useChangeInitialPassword`)
- `src/app/dashboard/DashboardPage.tsx` (`profile.id` vira `userId`)
- `src/auth/usePostLoginRedirect.ts`, `src/auth/LoginPage.tsx` (`from` como string, sessão do login)
- `src/app/guards/RequireAuth.tsx`, `RequireRole.tsx`, `RequireActiveSubscription.tsx`, `DefensiveLogout.tsx` (`hasIdentityError`, `from` como string)
- `src/router.tsx` (rota `/trocar-senha`, `RequirePasswordChange`, índice de `/admin`)
- `src/auth/pages.tsx` (exporta `TrocarSenhaPage`)
- `src/lib/validations/auth.ts` (`initialPasswordSchema`)
- `src/lib/auth-errors.ts` (`mapInitialPasswordError`)
- `src/index.css` (quatro valores da seção 5)

Remover:
- `src/hooks/useProfile.ts`, depois que os consumidores migrarem. Confirmar com `grep` antes de apagar.

Não tocar: `AuthLayout`, `RedefinirSenhaPage` (exceto R3, que é aceito), `EmpresasPage`, `admin-subscription`, marketing.

## 15. Dúvidas abertas

1. Aceita R1 (senha provisória fixa e leitura cross-tenant até o beta), com as salvaguardas (a) e (b)?
2. Aceita R2 com encerramento das outras sessões depois da troca? Recomendo sim.
3. Confirma os nomes de claim `user_role`, `tenant_id` e `must_change_password`?
4. `AdminDashboardPage` fica no código sem rota, ou sai? Este documento deixa no código.
