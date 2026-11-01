# Selo "Pacote" na agenda (ADR-07) — Revisor B

Exibe o agendamento-pacote na agenda: um `ComboTag` novo (pill neutro com ícone `Layers` + texto "Pacote") e, em `AppointmentBlock` (calendário) e `AgendaItem` (lista), o nome do pacote toma o lugar do nome do serviço quando `combo_id` está presente. A exibição reage ao dado da linha (`combo_id != null`), nunca ao segmento — correto, porque `combo_id` só nasce no ramo salão e o render não quebra se a flag mudar. Diff pequeno (3 arquivos, +62/−7), puramente apresentacional: nenhuma query, mutação, RLS, RBAC, segredo ou PII é tocada. Fecha a jornada ponta a ponta da fatia.

Watch for:
- Assimetria de a11y entre os dois caminhos de exibição (confirmed): o `AppointmentBlock` carrega "Pacote: <nome>" no `title`/`aria-label`, mas o `AgendaItem` da lista não tem `aria-label`/`title` — o sinal "Pacote" chega ao leitor de tela só pelo texto visível do `ComboTag`. Funciona, mas é um canal diferente do bloco; vale o QA confirmar a leitura por SR na lista.
- Contraste do selo (possible): o código *afirma* ≥ 4.5:1 via token `foreground`; a medição ao vivo (claro e escuro) é CA-07.5 e pertence ao QA, não foi verificada aqui.

**Verdict**: APPROVED

## High-level view

A decisão central — exibição orientada ao dado, não ao segmento — está implementada fielmente: `const isCombo = appointment.combo_id != null` decide nome e selo nos dois componentes, sem nenhum `useSegmentFeatures`/gating novo no caminho de leitura. Isso é a escolha certa da ADR (§Decisão, nota de "nenhum novo gating"): a regressão de ramo é garantida por construção, porque barbearia/clínica/legado nunca gravam `combo_id`.

O contrato de leitura já existia (ADR-04/06): `combo_id` e `combos:{name,price_cents}` estão em `AppointmentWithRelations` e no `APPOINTMENT_SELECT` como join embutido — a exibição não adiciona waterfall (RNF-S3), apenas consome o shape já carregado.

O ponto de cor reusa `serviceColorDotClass(combo_id ?? service_id)`, e o helper aceita `string | null | undefined` degradando de forma determinística — sem caso especial, como pede a ADR. Os fallbacks defensivos ("Pacote removido"/"Serviço removido") preservam o render sob shape inesperado.

A única observação de design é a assimetria de acessibilidade entre o bloco (que tem `title`/`aria-label` com "Pacote: <nome>") e a lista (que depende do texto visível do selo). Não bloqueia; é item de verificação do QA.

<details>
<summary>Issues (2)</summary>

1. **Assimetria de a11y lista vs. bloco** — `AgendaItem` não expõe `aria-label`/`title` indicando "Pacote"; o sinal chega ao SR só pelo texto visível do `ComboTag`, enquanto o `AppointmentBlock` o coloca em `title`/`aria-label`. Não é defeito (o texto é lido), mas o QA deve confirmar a leitura por tecnologia assistiva na lista; se insuficiente, considerar um rótulo textual explícito no item.
2. **Contraste do selo não medido aqui** — CA-07.5 (≥ 4.5:1 em claro e escuro) é afirmado no comentário de `ComboTag` mas depende de medição ao vivo no QA. Verificar no step seguinte; se abaixo, o próprio código já aponta o caminho (texto em `foreground`, que é o token usado).

</details>

<details>
<summary>Details</summary>

### Exibição orientada ao dado, não ao segmento

Nos dois componentes o gatilho é idêntico e mínimo:

```tsx
const isCombo = appointment.combo_id != null;
const itemName = isCombo
  ? (appointment.combos?.name ?? "Pacote removido")
  : (appointment.services?.name ?? "Serviço removido");
```

Não há leitura de `useSegmentFeatures` nem de `segment` no caminho de render — alinhado à nota da ADR de que nenhum gating novo por `combos` é necessário na exibição. A consequência de fronteira importa: `segment` continua sem papel algum na leitura, e a regressão de ramo (RF-S6/CA-07.4) é garantida por construção, não por um `if` que poderia ser esquecido — barbearia/clínica/legado nunca têm `combo_id`, logo nunca entram no ramo do selo. CA-07.2 (serviço avulso idêntico a hoje) cai naturalmente do mesmo `isCombo`.

### Selo `ComboTag`

Significado não depende só da cor: texto "Pacote" + ícone `Layers` (`aria-hidden`, correto — o texto já nomeia). O texto usa `text-foreground` e só fundo/borda são neutros (`bg-muted`/`border-border`) — a medição de contraste (CA-07.5) é do QA. `shrink-0` + o selo posicionado fora do span com `truncate` garantem que ele não seja cortado junto com o nome no bloco estreito/mobile.

### Title/aria-label e a assimetria entre os dois caminhos

No `AppointmentBlock`, `itemLabel = isCombo ? "Pacote: <nome>" : serviceName` alimenta tanto o `title` quanto o `aria-label`, cumprindo CA-07.1 para o bloco. No `AgendaItem` da lista não há `title`/`aria-label`; o leitor de tela recebe o nome do pacote e a palavra "Pacote" apenas pelo texto visível do `ComboTag`. É um canal diferente (texto visível vs. rótulo acessível). Lê corretamente, mas o QA deve validar a experiência de SR na lista — se o pipeline quiser paridade estrita com o bloco, um rótulo textual no item resolveria.

### Contrato de leitura e comissão intacta

A exibição só consome o shape já carregado: o embed `combos(name, price_cents)` e a coluna `combo_id` entraram no `APPOINTMENT_SELECT`/`appointmentRowSchema` em ADR-04/06, então não há request nova nem N+1 (RNF-S3 preservado) — o commit de ADR-07 não toca `useAppointments.ts`. A linha de comissão em ambos os componentes não é alterada pelo diff (continua gated por segmento+RBAC no pai, só em `concluido` não-compacto), logo RF-S12 não corre risco por aqui.

### Gate de build (CA-07.3)

- `npm run typecheck` (`tsc -b`) — verde.
- `npm run test` (`vitest run`) — 10 arquivos, 89 testes, todos passam.
- `npm run build` (`tsc -b && vite build`) — sucesso. (Aviso pré-existente de chunk > 500 kB, não introduzido por esta ADR.)

Não há script de lint no `package.json` nem config ESLint no repo; o gate de qualidade do projeto é typecheck + test + build, os três verdes. QA visual ao vivo (CA-07.4/CA-07.5) é o step seguinte — não executado aqui por decisão de pipeline.

</details>

<details>
<summary>Arquivos alterados</summary>

- `src/components/ComboTag.tsx` (novo) — selo "Pacote": pill neutro, ícone `Layers` + texto em `text-foreground`.
- `src/app/agenda/AppointmentBlock.tsx` — nome do pacote no lugar do serviço quando `isCombo`; `title`/`aria-label` "Pacote: <nome>"; `ComboTag` no bloco não-compacto; dot por `combo_id ?? service_id`.
- `src/app/agenda/AgendaPage.tsx` (`AgendaItem`) — mesma lógica na lista; `flex-wrap` para o selo; dot por `combo_id ?? service_id`.

Diff completo: `git show 0a832cf`.

</details>
