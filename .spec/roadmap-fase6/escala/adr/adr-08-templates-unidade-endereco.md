# ADR-08 — Templates de mensagem com `{unidade_endereco}`

- **Status**: Aceito (design congelado)
- **PRD**: §6.8 RF-45, W5
- **UX-SPEC**: §5 (editor/preview), §7 gating
- **Depende de**: ADR-02 (`units` + endereço), ADR-03 (leitura por unidade)
- **Bloqueia**: ADR-10 (mensagens contextuais na agenda), disparos por unidade
- **Escopo de escrita**: `src/lib/message-templates.ts`, `src/app/config/mensagens/`, `supabase/functions/_shared/`, `supabase/functions/campaign-dispatch/`

## Contexto

`TEMPLATE_VARIABLES` hoje é uma lista fechada de quatro variáveis (`nome`, `servico`,
`dataHora`, `empresa`). Não há endereço. Em multi-unidade, o cliente recebe o endereço da
matriz e vai ao lugar errado (W5). O renderer é server-side (disparos/Edge), com fallback
declarado em `TEMPLATE_FALLBACKS`; o editor só insere variáveis conhecidas.

## Decisão

### D1 — Variável nova na lista fechada

`TEMPLATE_VARIABLES` ganha `"unidade_endereco"` (token `{unidade_endereco}`). Ela é
**aditiva**: templates existentes continuam válidos; nenhuma variável antiga muda de nome. O
chip do editor (`VariableChips`/`TEMPLATE_VARIABLE_META`) recebe o rótulo pt-BR "Endereço da
unidade".

### D2 — Resolução server-side com fallback determinístico

Na hora do disparo, o renderer resolve a variável nesta ordem:

1. Endereço da unidade do atendimento (`appointments.unit_id` → `units`), formatado
   (logradouro, número, complemento, bairro, cidade/UF, CEP).
2. Se o atendimento não tem unidade ou a unidade foi inativada, endereço da unidade matriz
   (menor `created_at` entre as unidades do tenant).
3. Fallback final: endereço do tenant (campos de `tenants`), como hoje em `{empresa}`.

A resolução acontece **antes** da substituição; a variável nunca chega crua ao cliente. Se
nenhum endereço existir, o renderer usa string vazia controlada e registra evento técnico —
jamais o placeholder.

Nenhum `unit_id` vem do payload da campanha; ele é derivado do atendimento (ou do contexto
do disparo avulso, quando houver). Disparo sem atendimento (campanha de marketing) usa a
unidade matriz, explicitamente documentado no preview.

### D3 — Aviso de cobertura (não bloqueio duro)

No editor, quando `multiUnidade && units.length > 1`, template sem `{unidade_endereco}` exibe
aviso `role=status`: "Mensagens de confirmação/lembrete devem usar {unidade_endereco} para
não enviar o endereço errado." O aviso **não** impede salvar (retrocompatibilidade), mas é
coberto por teste e aparece na revisão de template. O disparo continua usando o fallback.

### D4 — Preview e testes de render

`TemplatePreview` renderiza com dados de fixture incluindo `unidade_endereco` (endereço
completo). Testes do `lib/message-templates` cobrem: variável conhecida, variável
desconhecida (rejeitada como hoje), fallback matriz, fallback tenant, e idempotência do
render (mesma entrada → mesma saída).

### D5 — Sem template novo por unidade

Templates continuam tenant-level (classe D). Não há template por unidade na v1; o que varia
é o **valor** da variável. Isso evita duplicação de conteúdo e mantém a régua única.

## Interface congelada

| Símbolo | Contrato |
|---|---|
| `TemplateVariable` | `"nome" \| "servico" \| "dataHora" \| "empresa" \| "unidade_endereco"` |
| `TEMPLATE_VARIABLES` | lista fechada com a nova variável no fim |
| `TEMPLATE_VARIABLE_META` | novo item `{ variable: "unidade_endereco", token: "{unidade_endereco}", label: "Endereço da unidade" }` |
| Resolução | unidade do atendimento → matriz → tenant → vazio controlado |
| Payload de disparo | nunca aceita `unit_id`; deriva do atendimento |
| Aviso de editor | `role=status`, apenas multi-unidade, nunca bloqueia salvar |

## Consequências

**Positivas**
- Cliente recebe o endereço correto sem duplicar templates.
- Retrocompatível: templates atuais seguem funcionando com fallback.
- Falha previsível e testada (nunca placeholder cru).

**Negativas / custos**
- Renderer passa a depender de `units` no caminho de disparo (mais uma leitura por lote).
- Endereço de unidade vira dado operacional exposto em mensagem (LGPD: é endereço comercial,
  não PII de cliente).

**Riscos e mitigação**
- *Risco*: disparo em lote fazer N+1 de unidade. *Mitigação*: join por atendimento no lote;
  teste de volume.
- *Risco*: unidade sem endereço completo gerar string estranha. *Mitigação*: formatador
  tolerante + teste com campos nulos.
- *Risco*: fallback silencioso mandar cliente para matriz errada. *Mitigação*: aviso no
  editor multi-unidade e evento técnico quando fallback é usado em tenant multi.

## Escopo

**Entra**
- Variável, chip, preview, renderer com fallback, aviso de cobertura, testes.

**Não entra**
- Template por unidade, endereço em mensagem de campanha segmentada por unidade, mudança na
  régua/opt-in, alteração de `{empresa}`.

## Arquivos afetados

| Arquivo | Ação |
|---|---|
| `src/lib/message-templates.ts` + test | variável, fallback, formatação |
| `src/app/config/mensagens/VariableChips.tsx` | chip novo |
| `src/app/config/mensagens/TemplateEditorDialog.tsx` | aviso multi-unidade |
| `src/app/config/mensagens/TemplatePreview.tsx` | fixture com endereço |
| `supabase/functions/_shared/` (renderer) | resolução unidade→matriz→tenant |
| `supabase/functions/campaign-dispatch/` | lote sem N+1 + derivação |

## Critérios de aceite (testáveis)

- [ ] `{unidade_endereco}` é reconhecida e substituída por endereço completo da unidade do
      atendimento.
- [ ] Atendimento sem unidade/ unidade inativa → endereço da matriz.
- [ ] Sem unidade e sem matriz → endereço do tenant; nunca placeholder.
- [ ] Template legado (sem a variável) continua salvando e disparando igual.
- [ ] Em multi-unidade, template sem a variável mostra aviso; salvar continua permitido.
- [ ] Variável desconhecida continua rejeitada (regra existente preservada).
- [ ] Preview e disparo produzem a mesma string para a mesma fixture.
- [ ] Disparo em lote não faz uma leitura de unidade por mensagem.

## Dependência / ordem

Depois de ADR-02/03. Pode ser implementada em paralelo a ADR-04..07; consumida pela UI de
mensagens (classe C) e pela agenda (ADR-10).
