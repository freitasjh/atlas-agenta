# ADR-09 — UI: switcher de unidade + ConfigHub + lista/detalhe/wizard

- **Status**: Aceito (design congelado)
- **PRD**: §6.1 RF-01..RF-07, §6.2 RF-08/RF-09, §12 D1..D8
- **UX-SPEC**: §5 (`UnitSwitcher`, `/app/config/unidades*`), §9 a11y, §10 estados
- **Depende de**: ADR-04 (contexto), ADR-05 (RPCs), ADR-01 (gate/limite)
- **Bloqueia**: ADR-10/11 (usam switcher), ADR-12 (topbar mobile reusa)
- **Escopo de escrita**: `src/components/`, `src/app/config/`, `src/router.tsx`, `src/app/ConfigHubPage`

## Contexto

O chrome atual tem sidebar desktop e Sheet mobile, sem seletor de unidade. ConfigHub lista
atalhos (serviços, recursos, profissionais, plano etc.) mas não tem "Unidades". Não existem
páginas de unidade nem wizard. O UX-SPEC exige: switcher com `menuitemradio`, agregado com
`Building2`, dropdown até 6 e dialog acima; lista com 5 estados distintos; detalhe em 4 tabs;
wizard 4 passos + revisão; inativação com confirmação por nome.

## Decisão

### D1 — `UnitSwitcher` (componente único)

Um componente, duas montagens (sidebar desktop abaixo do logo; topbar mobile — ADR-12):

- Trigger 44px com avatar de iniciais (`bg-primary/10 text-primary`), nome ou "Todas as
  unidades" + chevron; `aria-haspopup="menu"` e `aria-expanded`.
- Conteúdo: `DropdownMenu` com `menuitemradio`/`aria-checked` até 6 unidades; acima de 6,
  `Dialog` com busca (D7). Agregado é o primeiro item, com `Building2`.
- Teclado: setas navegam, `Esc` fecha, foco volta ao trigger; live region "Unidade ativa: X".
- Não renderiza quando `!isMulti` (unidade única = zero fricção).
- Unidade inativa: `Badge secondary`, selecionável para leitura histórica (D8).
- Sem cor por unidade (D5); cor nunca é o único sinal.

### D2 — Rotas novas

| Rota | Página | Guard |
|---|---|---|
| `/app/config/unidades` | lista | `RequireRole(["admin"])` + `EntitlementGate multiUnidade` |
| `/app/config/unidades/nova` | wizard | idem + limite de quota |
| `/app/config/unidades/:unidadeId` | detalhe (tabs) | idem; unidade fora da lista permitida → StatePanel |

`ConfigHubPage` ganha o card "Unidades" com contagem e estado (gate/limite), visível só com
`multiUnidade` (sem request quando ausente).

### D3 — Lista de unidades

Cards no mobile / `Table` no desktop com colunas Unidade (avatar+nome+`short_name`),
Endereço, Equipe (nº), Status (`Badge`), Atendimentos 7d, Ações. Cinco estados distintos:
loading (`Skeleton`/`aria-busy`), vazio (StatePanel + CTA), erro (StatePanel + retry), gate
OFF (EntitlementGate + upsell, **zero request**), limite (CTA disabled + copy + link de
planos, distinta de gate). Sem scroll horizontal em 375.

### D4 — Detalhe em 4 tabs

- **Dados**: nome/`short_name`/endereço (CEP→`useCepLookup`)/telefone; fuso exibido como
  herdado (read-only, com texto explicando).
- **Horários**: `WeekScheduleForm` escopado à unidade + "copiar de" (matriz/outra unidade);
  em agregado a edição é bloqueada (classe C) com CTA "Escolher unidade".
- **Equipe**: associar/remover membros existentes; remoção bloqueada com agendamento futuro
  (erro `future_appointments` mapeado para texto com a data do próximo atendimento).
- **Recursos**: CRUD + "copiar da matriz"; estado vazio próprio.

Inativar: `Dialog` de confirmação digitando/confirmando pelo **nome**; se houver futuros,
mostra a contagem e o efeito (sai de novas criações, permanece no histórico). Nunca `delete`.

### D5 — Wizard 4 passos + revisão

Passos: 1 Dados (nome, `short_name` ≤12, CEP→endereço, telefone, saldo inicial opcional) →
2 Horários (7 dias + "copiar de") → 3 Equipe (associar existentes) → 4 Recursos (opcional +
"copiar da matriz") → Revisão editável. Passos 3–4 puláveis. Validação on blur; `short_name`
com contador; botão "Criar unidade" com `idempotency_key` gerada no início e reusada em
retry. Sucesso: 3 CTAs (Abrir agenda da unidade, Ver unidade, Adicionar outra). **Nunca**
re-semeia catálogo (W4) — o wizard não chama nada de `services`/`products`.

### D6 — Classe B e "Unidade" como 1º campo

Em formulários de criação de entidades classe B acessados no agregado, a UI abre interstitial
de escolha de unidade antes do form (D2/D3 do UX-SPEC) e "Unidade" aparece como primeiro
campo obrigatório. Nenhuma tela escolhe unidade padrão pelo usuário.

### D7 — Acessibilidade e movimento

Alvos ≥44px; `ring-2 ring-ring offset-2`; crossfade 150–200ms respeitando
`prefers-reduced-motion`; `role=status` na troca; sem ícone como único rótulo; contraste AA
nos dois temas.

## Interface congelada

| Componente/rota | Contrato |
|---|---|
| `UnitSwitcher` | props `{ variant: "sidebar" \| "topbar" }`; consome `useUnit()`; não renderiza sem `isMulti` |
| `/app/config/unidades` | lista com 5 estados; colunas do D3 |
| `/app/config/unidades/:id` | tabs `dados\|horarios\|equipe\|recursos` (query `?tab=`) |
| `/app/config/unidades/nova` | passos `1..4` + `revisao`; `?step=` refletindo o passo |
| Erros de UI | `units_limit_reached`, `not_admin`, `future_appointments`, `unit_not_found` → mensagens pt-BR distintas |

## Consequências

**Positivas**
- Switcher e cadastro seguem o DS real, sem token novo.
- Gate/limite/erro têm estados visuais distintos (não confundem upsell com limite).
- Wizard idempotente e sem efeito colateral no catálogo.

**Negativas / custos**
- Muitas superfícies novas (1 componente + 3 páginas + hub) e 5 estados por tela.
- Duas variantes de switcher exigem teste em 375 e 1280.

**Riscos e mitigação**
- *Risco*: switcher em agregado permitir escrita. *Mitigação*: `canWriteHere` desabilita CTAs;
  teste de agregado sem CTA primário.
- *Risco*: wizard duplicar unidade em retry. *Mitigação*: chave de idempotência estável por
  tentativa + teste de replay.
- *Risco*: lista vazar unidade sem permissão. *Mitigação*: lista vem do RLS; teste com
  profissional restrito.

## Escopo

**Entra**
- Switcher, hub, lista, detalhe, wizard, confirmação de inativação, estados, a11y, rotas,
  mensagens de erro.

**Não entra**
- Shell mobile/tab bar (ADR-12), agenda (ADR-10), consolidação (ADR-11), back-office (ADR-14),
  delete físico, edição de plano.

## Arquivos afetados

| Arquivo | Ação |
|---|---|
| `src/components/UnitSwitcher.tsx` (novo) + test | switcher |
| `src/components/AppSidebar.tsx` | montar switcher |
| `src/app/config/ConfigHubPage.tsx` | card Unidades |
| `src/app/config/unidades/UnidadesPage.tsx` (novo) + test | lista |
| `src/app/config/unidades/UnidadeDetalhePage.tsx` (novo) + test | tabs |
| `src/app/config/unidades/NovaUnidadeWizard.tsx` (novo) + test | wizard |
| `src/app/config/unidades/components/` (novo) | tabs Dados/Horários/Equipe/Recursos |
| `src/router.tsx` | rotas |

## Critérios de aceite (testáveis)

- [ ] `multiUnidade=false/null`: switcher ausente, card do hub ausente, zero request a `units`.
- [ ] `units=1`: switcher ausente mesmo com entitlement.
- [ ] `units>1`: switcher lista unidades; teclado (setas/Esc) e `aria-checked` corretos.
- [ ] Troca no switcher persiste e recarrega a rota com `?unidade`.
- [ ] `?unidade` sem permissão → StatePanel genérico, sem nome no DOM.
- [ ] Lista: 5 estados verificáveis; limite desabilita CTA com copy distinta de gate.
- [ ] Wizard conclui em ≤5 min de fluxo; passos 3–4 puláveis; replay não duplica.
- [ ] Criar unidade não cria serviço/produto.
- [ ] Inativar exige confirmação pelo nome e mantém a linha na lista.
- [ ] Remover membro com futuro bloqueia com data do próximo atendimento.

## Dependência / ordem

Depois de ADR-04/05. Antes de ADR-10/11 (reusam switcher e navegação) e ADR-12 (topbar).
