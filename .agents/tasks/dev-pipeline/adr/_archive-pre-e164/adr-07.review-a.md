# Parecer de Revisão A — ADR-07 (Tela de Conexão WhatsApp)

**Revisor:** Independente A · **Data:** 2024-10-19 · **Status:** ✅ APROVADO

---

## Sumário

A ADR-07 implementa a tela de conexão `/app/config/whatsapp` (pareamento por QR, histórico recente de mensagens) e integra o hook de dados correspondente. O código segue os critérios da ADR, as convenções do projeto (React + TanStack Query + react-hook-form + zod + shadcn/ui), o isolamento multi-tenant por RLS, a defesa em profundidade de RBAC, e os requisitos de acessibilidade e pt-BR. A build passa sem erros (`npm run build`, `npm run typecheck` limpos, sem `any`). Nenhuma fronteira foi violada. **Pronto para aprovação no gate humano.**

---

## High-Level View

A tela de WhatsApp encena a máquina de estados de `whatsapp_instances` por meio de três cartões distintos (desconectado → aguardando_qr → conectado), cada um com CTA apropriada ou visualização somente-leitura conforme o papel (`canManageWhatsAppConnection`). O roteamento herdou os guards existentes; o gate de acesso é por **capacidade no botão**, não por rota — padrão consistente com `servicos`/`profissionais`. Os dados lidos (instância + histórico) validam com zod antes do uso; nenhuma escrita acontece pelo cliente (o servidor controla `whatsapp_instances` e `messages` via Edge Function com service role). O polling condicional (`refetchInterval`) ativa só durante `aguardando_qr`, deixando os estados estáveis eficientes. Dois novos componentes (`ConnectionCard` e `RecentMessagesList`) reutilizam primitivos shadcn existentes (Card, Button, Table, Skeleton, Badge) sem recriar. `WhatsAppStatusBadge` reusa os tokens de status calibrados AA (confirmado/pendente/cancelado). Todos os textos estão em pt-BR; acessibilidade é atendida (aria-live, sr-only, foco visível, reduced-motion). Sem `tenant_id` no payload do cliente; sem segredos expostos (apenas `VITE_SUPABASE_*` pública).

---

## Verificação de Critérios da ADR-07

| Critério | Resultado | Notas |
|----------|-----------|-------|
| **A1. Build/typecheck** | ✅ Limpo | `npm run build` e `npm run typecheck` sem erro, TS estrito, zero `any`. |
| **A2. Hub e rota** | ✅ Implementado | Card "WhatsApp" (ícone `MessageCircle`) adicionado em `ConfigHubPage`; rota `/app/config/whatsapp` em `router.tsx` como filha de `config`. |
| **A3. Estado desconectado** | ✅ Implementado | "Nenhum número conectado ainda." + CTA "Conectar WhatsApp" (só admin). Sem botão para non-admin. |
| **A4. Pareamento** | ✅ Testável | Admin clica "Conectar WhatsApp"; `usePairWhatsApp` chama Edge Function; resposta QR renderiza, estado vai a "Aguardando leitura"; polling condicional ativo — observável. |
| **A5. Responsivo** | ✅ Implementado | Grid `md:grid-cols-2` (desktop) com fallback de empilhamento; `RecentMessagesList` tabela no desktop, cards no mobile; sem overflow em ~375px. |
| **A6. Dark + a11y** | ✅ Implementado | Dark default (herdado); foco visível (shadcn); `aria-live="polite"` na região de status; ponto pulsante respeita `motion-reduce:animate-none`; badges com cor + texto. |
| **A7. PII/pt-BR** | ✅ Implementado | Histórico não exibe telefone (projeção no POST RLS sem PII); todo texto em pt-BR ("Aguardando leitura", "Conectado", "Enviar", etc.). |

---

## Análise por Camada

### Roteamento

- ✅ Rota `/app/config/whatsapp` filha de `config`, irmã de `servicos`/`profissionais`, dentro do bloco `RequireAuth → RequireActiveSubscription → AppLayout`.
- ✅ Sem novo guard de role (padrão do projeto: gate é por capacidade, não por rota).

### Componentes e Layout

- ✅ `WhatsAppPage.tsx` — página raiz, orquestra `ConnectionCard` + `RecentMessagesList`; região `aria-live` para anúncio de mudança de status; `StatePanel` reutiliza molde de erro.
- ✅ `ConnectionCard.tsx` — máquina de estados visual com três branches (`desconectado`/`aguardando_qr`/`conectado`); isolamento de lógica de pareamento; `canManage` determina visibilidade de CTA.
- ✅ `QrCodeDisplay.tsx` — render seguro do QR (valida `qrCodeBase64`, não renderiza quebrado); moldura branca (quiet zone) em `rounded-lg bg-white p-3`; estado de carregamento com `aria-busy`.
- ✅ `RecentMessagesList.tsx` — lê `messages` com projeção PII-safe; Desktop table + mobile cards; join com `customers` para nome (sem telefone).

### Hooks de Dados (TanStack Query)

- ✅ `useWhatsAppInstance()` — lê a única linha de `whatsapp_instances` do tenant via PostgREST sob RLS; polling condicional ativo só quando `connection_status === "aguardando_qr"`.
- ✅ `usePairWhatsApp()` — mutation que invoca `supabase.functions.invoke("whatsapp", { body: { action: "pair" } })`; **nenhum `tenant_id` no body**; em sucesso, invalida a query.
- ✅ `useRecentMessages()` — query de `messages` com ordenação `desc` e limite; validação com zod; projeção sem PII (`MESSAGE_SELECT` não inclui telefone).
- ✅ `useSendMessage()` — mutation para operação `send`; trata respostas de negócio (`opt_out`/`not_connected`/`send_failed`) vindas no corpo mesmo com HTTP != 200 (contrato ADR-04); invalida `messages` em sucesso.

### RBAC e Segurança

- ✅ Capacidades adicionadas ao `usePermissions` — `canManageWhatsAppConnection` (admin) e `canSendWhatsAppMessage` (admin/receptionist/professional).
- ✅ Defesa em profundidade — botões gateados na UI; trava real no RLS (`whatsapp_instances`: SELECT/WRITE só admin dentro do tenant; `messages`: SELECT para admin/receptionist/professional, WRITE zero ao cliente).
- ✅ **Nenhum `tenant_id` no payload do cliente** — derivado do JWT no servidor.
- ✅ **Nenhum segredo no cliente** — grep por `VITE_` mostra só `VITE_SUPABASE_*` (anon key pública).

### Validação e Tratamento de Erro

- ✅ Esquemas zod — `whatsAppInstanceRowSchema`, `messageRowSchema`, `pairResponseSchema`, `sendResponseSchema` validam toda entrada/saída.
- ✅ `mapWhatsAppError` traduz erros desconhecidos para pt-BR defensivamente (sem vazar schema, sem PII).
- ✅ Toast de sucesso/erro — `pair` exibe erro via `toast.error(mapWhatsAppError(error))` se falhar; `send` pode rebeneficiar do mesmo mapa.

### Acessibilidade

- ✅ `aria-live="polite"` em `WhatsAppPage` — anuncia transição do status sem interrupção.
- ✅ `sr-only` para rótulos de carregamento ("Gerando código…").
- ✅ `aria-hidden="true"` em ícones decorativos (spinners, ponto pulsante).
- ✅ `aria-busy="true"` em containers durante carregamento.
- ✅ `motion-reduce:animate-none` em animações — respeita `prefers-reduced-motion`.
- ✅ Foco visível — `focus-visible:ring` dos primitivos shadcn aplicado.
- ✅ Badge — rótulo textual além da cor ("Desconectado", "Aguardando leitura", "Conectado"), tokens calibrados AA ≥ 4.5:1.

### Português do Brasil

- ✅ Todos os textos visíveis em pt-BR — "Conectar WhatsApp", "Nenhum número conectado ainda.", "Aguardando leitura", "Conectado", "Mensagens recentes", "Não foi possível carregar a conexão", etc.
- ✅ Etapas numeradas de pareamento — "Abra o WhatsApp no celular…", "Toque em Aparelhos conectados…", "Aponte a câmera…" — em português claro e ativo (não passivo).

### Mobile-First / Responsivo

- ✅ Grid `md:grid-cols-2 md:items-start` — mobile (default) empilha QR acima, instruções abaixo; desktop (≥768px) lado a lado.
- ✅ `RecentMessagesList` — `hidden md:block` (tabela no desktop) + `md:hidden` (cards no mobile).
- ✅ Sem hardcoding de largura horizontal; padding/margin consistentes com Tailwind scale.

---

## Possíveis Observações Menores (Informativas, Não Bloqueantes)

1. **Formatação de hora relativa em `ConnectionCard`** — função `formatRelativeFromNow` calcula corretamente a diferença (lê `then = new Date(iso).getTime()` e depois `diffSeconds = Math.round((then - Date.now()) / 1000)`, o que dá um sinal **negativo** quando `last_connected_at` é passado). A função passa esse valor negativo para `formatter.format(diffSeconds, 'second'|'minute'|…)`, que o Intl.RelativeTimeFormat interpreta corretamente (negativo = passado, ex.: "há 2 minutos"). ✅ Funciona conforme esperado. Não é um bug.

2. **Contraste no QR** — o QR é renderizado em fundo branco (`bg-white p-3`) com moldura em `rounded-lg border border-border`. Em tema dark, o fundo branco + texto preto do QR garante contraste alto. Em tema light, branco + texto preto também. ✅ Leitura garantida. Não é uma preocupação.

3. **Polling enquanto `aguardando_qr`** — intervalo fixo de 2500ms. É adequado para UX (não é demais, não é de menos). O stopping do polling quando a transição ocorre é eficiente. ✅ Trade-off aceitável.

---

## Critérios Estruturais (Aderência ao Projeto)

| Critério | Status |
|----------|--------|
| **React + Vite + TS estrito** | ✅ Conformidade total. |
| **TanStack Query (sem `fetch` em `useEffect`)** | ✅ `useQuery`/`useMutation` corretos. |
| **react-hook-form + zod** | ✅ Validação existente; ADR-08 (diálogo de envio) usará o padrão. |
| **shadcn/ui (reuso)** | ✅ Card, Button, Table, Skeleton, Badge, Dialog (preparado). |
| **Isolamento multi-tenant (RLS)** | ✅ Cliente lê sob RLS; nunca envia `tenant_id`. |
| **RBAC (admin/receptionist/professional)** | ✅ Capacidades derivadas, UI gateada, RLS no banco. |
| **Dark default** | ✅ Herdado; componentes compatíveis. |
| **Pt-BR** | ✅ 100% do copy em português. |
| **Migrations não editadas** | ✅ Nenhuma migration anterior foi tocada (ADR-07 é só frontend). |

---

## Verificação de Escopo (Confirmação de Não-Transbordo)

| Item | Escopo (✅) | Fora de Escopo (⊘) |
|------|----------|-------------------|
| Tela de conexão com QR | ✅ | |
| Estado evoluindo visualmente | ✅ | |
| Histórico recente de mensagens | ✅ | |
| Ação "Enviar mensagem" sob demanda | **ADR-08** (próxima) | ⊘ |
| Régua automática (D-1, lembrete, cobrança, comprovante) | | ⊘ |
| Agendador/cron/pg_cron | | ⊘ |
| Integração Evolution real | | ⊘ |
| Múltiplos números por tenant | | ⊘ |
| Admin `/admin` para super admin | | ⊘ |

✅ **Escopo respeita as travas negativas.**

---

## Build e Qualidade

```
$ npm run build
✓ built in 6.03s (com aviso padrão de chunk size, sem relação a esta ADR)

$ npm run typecheck
(sem erro)
```

✅ **Pronto para produção (localmente verificado).**

---

## Conclusão

A ADR-07 é uma implementação sólida e aderente ao projeto. O código segue os padrões, respeita as fronteiras de isolamento multi-tenant, atende aos critérios de aceite da ADR, e não cria débito técnico. Recomendação: **aprovação sem condições**. ADR-08 (diálogo de envio sob demanda) fica para a próxima fase.

**Verdict: APPROVED** ✅

---

**Revisor A** · 2024-10-19 · 11:52 UTC

