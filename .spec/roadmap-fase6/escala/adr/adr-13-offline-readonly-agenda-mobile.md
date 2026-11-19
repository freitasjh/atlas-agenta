# ADR-13 — Offline somente leitura + agenda mobile do dia

- **Status**: Aceito (design congelado)
- **PRD**: §6.5 RF-32/RF-33, §7 (offline), §12 D10/D11, R10
- **UX-SPEC**: §4 fluxo 4, §5 "Agenda mobile do dia" e "Offline/instalação"
- **Depende de**: ADR-12 (shell/SW), ADR-04 (chaves), ADR-10 (cartão de atendimento)
- **Bloqueia**: nada
- **Escopo de escrita**: `src/lib/offline/`, `src/hooks/`, `src/app/mobile/agenda/`, `vite.config.ts`

## Contexto

A fase exige degradação honesta quando a rede cai: o profissional/recepção precisa **ler** a
agenda do dia, mas qualquer escrita offline é proibida (zero escrita otimista, zero fila,
zero sync) — R10. Cache de financeiro é vetado. Sem `appMobile`, nada disso existe. O cache
precisa ser escopado por tenant/usuário/unidade/dia, e limpo no sign out para não vazar entre
contas.

## Decisão

### D1 — Escopo do cache: somente agenda do dia

Whitelist **fechada** de persistência de query:

| Persistido | Não persistido |
|---|---|
| `useAppointments` de **um dia** (`day` = hoje no fuso do tenant) e **uma unidade** (ou agregado somente leitura) | Financeiro, DRE, cobranças, ledger, clientes completos, prontuário, mensagens |
| Campos mínimos do cartão: hora, status, nome do cliente, serviço, profissional, unidade (`short_name`) | Documento, telefone, endereço de cliente, valores/`price_cents`, notas |

Implementação: `persistQueryClient` (TanStack) com `dehydrate`/`shouldDehydrateQuery`
restringindo por **prefixo de chave** de agenda do dia; storage IndexedDB; `maxAge` 24h;
`buster` versionado por release. Nada de cache de resposta HTTP autenticada no Workbox.

### D2 — Escopo por identidade e unidade

A chave persistida inclui `tenant_id` (do JWT, não do URL), `profile_id`, `unitId` e `day`.
Na hidratação, só consultas do mesmo par usuário/tenant/unidade são restauradas. Sign out,
troca de tenant e troca de unidade **limpam** a persistência de agenda (não apenas
invalidam). Usuário sem permissão em unidade não hidrata dados dela.

### D3 — Leitura offline e escrita bloqueada

- `useOnlineStatus()` (eventos `online`/`offline` + `navigator.onLine`) é a fonte do estado.
- Mutações escopáveis passam por um wrapper que, offline, rejeita com código
  `offline_read_only` **antes** de tocar a rede; `networkMode: "online"` nas mutations do
  QueryClient como segunda barreira.
- Nenhuma mutação otimista em nenhuma tela (já é o padrão; vira critério de aceite).
- CTAs de escrita ficam `disabled` com descrição acessível ("Indisponível sem conexão"),
  nunca escondidos.
- Fora da agenda do dia, tela sem cache mostra StatePanel "Sem conexão — esta tela precisa de
  internet" com retry.

### D4 — Banner, reconexão e refetch

Banner fixo `role="status"`, `aria-live="polite"`, sem roubar foco: "Você está offline.
Mostrando a agenda do dia salva." Ao reconectar: banner "Conexão restaurada", refetch das
queries ativas (`invalidateQueries` do escopo), sem reenviar nada que tenha sido bloqueado.
Nenhuma fila, nenhum replay, nenhuma promessa de "tentaremos depois".

### D5 — Agenda mobile do dia

Tela do shell `appMobile` (4ª? não — rota `Agenda`): chips de 7 dias (`aria-pressed`,
scroll-snap horizontal), lista de cartões com hora, status (badge textual), cliente, serviço,
unidade (quando `isMulti`) e profissional; ações de 44px **sem swipe**; pull-to-refresh
opcional apenas online. Offline: usa a persistência do D1 e mantém as mesmas informações
mínimas; dados ausentes aparecem como "—" (nunca inventados).

### D6 — Sem cache quando sem entitlement

Sem `appMobile`: nenhum registro de persistência, nenhuma hidratação, nenhum SW (ADR-12),
casca atual. O código de offline é inerte.

## Interface congelada

| Símbolo | Contrato |
|---|---|
| `useOnlineStatus(): boolean` | reativo a `online`/`offline` |
| `offlineStorage` | IndexedDB via `persistQueryClient`; chave com tenant/profile/unit/day |
| Predicado de persistência | apenas prefixo de agenda do dia; whitelist de campos do cartão |
| Código de erro | `offline_read_only` (pt-BR na UI) |
| Banner | `role="status"`, `aria-live="polite"`, dois textos (offline/restaurada) |
| Limpeza | sign out / troca de tenant / troca de unidade → purge do cache |
| Tela sem cache | StatePanel "Sem conexão" + retry; sem CTA de escrita |

## Consequências

**Positivas**
- Agenda do dia legível sem rede, sem risco de divergência de dados.
- PII mínima em disco e limpeza determinística no sign out.
- Zero escrita otimista/fila (risco R10 fechado por design).

**Negativas / custos**
- Persistência de query adiciona superfície de privacidade (dado em IndexedDB).
- Manter whitelist de campos exige revisão quando o cartão evoluir.

**Riscos e mitigação**
- *Risco*: cache de financeiro entrar na persistência por descuido. *Mitigação*: predicado por
  prefixo (allowlist), teste negativo com query keys financeiras.
- *Risco*: vazar agenda entre usuários no mesmo dispositivo. *Mitigação*: purge no sign out +
  chave com `profile_id`; teste de troca de usuário.
- *Risco*: UI prometer sincronização. *Mitigação*: copy fixa "somente leitura"; teste de CTAs
  disabled e ausência de fila.
- *Risco*: banner roubar foco de leitor de tela. *Mitigação*: `aria-live=polite`, sem
  `autoFocus`.

## Escopo

**Entra**
- Detecção de rede, persistência restrita, purge, bloqueio de escrita, banner/reconexão,
  agenda mobile do dia, estados offline, testes negativos.

**Não entra**
- Escrita offline, fila/sync, cache de financeiro/clientes/prontuário, background sync,
  notificações push, cache de HTML autenticado.

## Arquivos afetados

| Arquivo | Ação |
|---|---|
| `src/hooks/useOnlineStatus.ts` (novo) + test | estado de rede |
| `src/lib/offline/persist.ts` (novo) + test | predicado + purge |
| `src/lib/queryClient.ts` | `networkMode`, persistência |
| `src/hooks/useAppointments.ts` | guard offline + hidratação |
| `src/app/mobile/agenda/AgendaMobileDay.tsx` (novo) + test | chips + cartões |
| `src/app/mobile/OfflineBanner.tsx` (novo) | banner |
| `src/components/ui/` (mutations) | CTA disabled com descrição |
| `vite.config.ts` | Workbox sem runtime cache autenticado |

## Critérios de aceite (testáveis)

- [ ] Offline: agenda do dia renderiza a partir do cache; demais telas mostram StatePanel.
- [ ] Nenhuma request de escrita é disparada offline; CTAs disabled com descrição.
- [ ] Nenhuma escrita otimista/fila; `offline_read_only` é o erro quando forçado.
- [ ] Reconexão mostra banner e refaz fetch; nada é reenviado automaticamente.
- [ ] Query de financeiro nunca é persistida (teste negativo).
- [ ] Sign out e troca de usuário limpam a persistência; outro usuário não vê a agenda.
- [ ] Cache expira em 24h e é versionado por release.
- [ ] Chips de 7 dias com `aria-pressed`, scroll-snap; cartões com os 6 campos; ações 44px.
- [ ] Sem `appMobile`: nenhuma persistência/SW, comportamento atual intacto.

## Dependência / ordem

Depois de ADR-12 (shell) e ADR-10 (cartão/agenda). Última das ADRs de app.
