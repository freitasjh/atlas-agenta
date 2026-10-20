# ADR-05 — Conteúdo das telas-casca: placeholders pt-BR das quatro áreas e aceite visual consolidado

**Status:** proposto
**Escopo:** frontend (telas-casca / conteúdo)
**Depende de:** ADR-04 (rotas, layouts, guards) e ADR-02 (`PlaceholderPanel`, `StatusBadge`,
`Logo`). É a última ADR do scaffold — fecha o critério de aceite de ponta a ponta.

## Contexto

Com roteamento, layouts, tema e design system prontos, falta o conteúdo-casca de cada rota:
placeholders em pt-BR que provem a navegação e deem forma às quatro áreas, sem lógica de
negócio (PRD §2.2/§2.3, analysis-frontend §1/§6). Esta ADR preenche cada rota com
`PlaceholderPanel` (ADR-02) e adiciona as poucas superfícies visuais exigidas pelo critério de
aceite: a landing de marketing, a amostra de `StatusBadge` na casca da agenda, e textos pt-BR
em todas as telas. É também o ponto natural do **QA consolidado** das ADRs adiadas.

## Decisão

1. **Marketing** (`src/marketing/`):
   - `/` — landing com hero (proposta de valor do Atlas Agenda: agenda + cobrança via
     WhatsApp/PIX, reduzir no-show) usando `Logo`, `Button` e tipografia display. Sem CTA
     funcional além de links de navegação.
   - `/precos` — `PlaceholderPanel` apresentando os três planos (Individual/Clínica/Pro) em
     texto pt-BR (sem checkout).
   - `/termos` — `PlaceholderPanel` "Termos & Privacidade (LGPD)".
2. **Auth** (`src/auth/`): `/login`, `/cadastro`, `/recuperar-senha` como `PlaceholderPanel`
   dentro do `AuthLayout`, textos pt-BR. **Sem** submit/sessão real (fora de escopo). Pode
   exibir campos desabilitados ou só o placeholder — nenhuma chamada a Supabase.
3. **App / tenant** (`src/app/`):
   - `/app` — painel inicial do tenant (`PlaceholderPanel` "Dashboard").
   - `/app/agenda` — `PlaceholderPanel` "Agenda" + **amostra de `StatusBadge`** com os 6
     status (`pendente`, `confirmado`, `em_atendimento`, `concluido`, `cancelado`,
     `nao_compareceu`) — cumpre o critério visual §7.
   - `/app/clientes`, `/app/cobrancas`, `/app/config` — `PlaceholderPanel` pt-BR cada.
4. **Admin** (`src/admin/`): `/admin` (`PlaceholderPanel` "Painel do super admin") e
   `/admin/empresas` (`PlaceholderPanel` "Empresas assinantes", podendo mostrar amostra de
   badge de `SubscriptionStatus`). Textos pt-BR.
5. **Consistência pt-BR:** todo texto visível (incluindo 404 e labels) em português do Brasil
   (CA-11). Nenhuma string "atlas-cobranca".
6. **Fora de escopo (não implementar):** login/sessão real, RBAC efetivo, leitura de
   `subscription_status`, tela de quitação, telas reais de agenda/clientes/cobranças, Edge
   Functions, Asaas/Evolution, autoagendamento/taxa de reserva/métricas (Fase 3).

## Consequências

- O scaffold fica navegável e visualmente coerente de ponta a ponta; todos os CA do PRD ficam
  verificáveis.
- As telas-casca usam `PlaceholderPanel` padronizado — as fases seguintes substituem conteúdo
  sem tocar em rotas/layouts/tema.

## Arquivos afetados

- `src/marketing/{Landing,Precos,Termos}.tsx`
- `src/auth/{Login,Cadastro,RecuperarSenha}.tsx`
- `src/app/{Dashboard,Agenda,Clientes,Cobrancas,Config}.tsx`
- `src/admin/{AdminHome,Empresas}.tsx`
- `src/router.tsx` (liga cada rota ao seu componente de conteúdo)

## Critérios de aceite testáveis (desta ADR = aceite consolidado do scaffold)

1. `npm install` + `npm run build` em clone limpo concluem sem erro/warning de tipo. (CA-01)
2. `npm run dev` sobe a SPA e ela carrega sem erro no console. (CA-02)
3. `/`, `/precos`, `/termos` renderizam conteúdo pt-BR sem erro no console. (CA-03)
4. `/login`, `/cadastro`, `/recuperar-senha` idem. (CA-04)
5. `/app` e `/app/{agenda,clientes,cobrancas,config}` idem; agenda mostra os 6 `StatusBadge`.
   (CA-05, critério visual §7)
6. `/admin` e `/admin/empresas` idem. (CA-06)
7. URL inexistente → 404 em pt-BR. (CA-07)
8. Com `.env` ausente a app ainda navega e emite mensagem pt-BR no console (fecha o runtime da
   ADR-03). (CA-09)
9. Dark default, fundo ardósia, fontes locais (sem Google Fonts), nenhuma requisição a
   Supabase no load. (CA-10, critério visual §2/§8)
10. Todo texto visível em pt-BR; `<html lang="pt-BR">`; nenhuma string "atlas-cobranca". (CA-11)

## Verificação

- `cd <workdir> && npm install && npm run build` → limpo.
- **QA consolidado via Chrome DevTools** (este é o momento "now" de ponta a ponta): subir
  `npm run dev`, navegar a todas as 13 rotas + uma URL inexistente, conferir dark default,
  amostra de badges na agenda, responsividade da sidebar (375px vs ≥768px), toggle de tema
  persistente, fontes locais e ausência de request a Supabase na aba Network, e ausência de
  erro no console. Fechar o dev server ao terminar.
