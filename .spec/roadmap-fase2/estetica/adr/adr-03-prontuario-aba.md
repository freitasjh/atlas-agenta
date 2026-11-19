# ADR-03 — G4 Prontuário UI: 4ª aba Drawer + ficha/evolução (zero backend)

- Status: proposto

## Contexto

`clinical_records` existe (schema append-only + RLS + trigger) com valor zero por falta de UI. UX-SPEC T1 exige 4ª aba no Drawer + ficha atual + evolução timeline, com emendas B1 (tabs single-row scroll), B3 (tabpanel hidden + underline além da cor) e ajustes 1–8 aplicáveis. RBAC clínico×financeiro: receptionist vê só banner alergia; admin/professional full (LGPD dado saúde). Zero backend novo.

## Decisão

4ª aba `Prontuário` no Drawer existente, só leitura/append via cliente sob RLS (sem Edge, sem migration):

- `TabsList` 4 cols em linha única SEMPRE, scroll horizontal em 375px (B1); painéis `role=tabpanel` + `aria-labelledby`, inativos com `hidden` (B3); selecionada com underline além da cor.
- Ordem: banner alergias (sticky, destructive, `aria-live`) → ficha atual (3 grupos colapsáveis, `<label for/id>`, contadores x/500 via `aria-describedby` + `maxlength`, read-only + "Corrigir (nova versão)" append-only, v1 intacta) → evolução timeline (badge v1/v2, link ver original, "Nova evolução" append).
- Gating `prontuario` (ADR-01): sem entitlement → aba HABILITADA com `title` explicativo + empty + upsell alcançável (desvio intencional do `disabled` previsto — `disabled` escondia o upsell do teclado; padrão igual à aba Pagamento); dado gravado segue legível.
- Ajustes aplicados aqui: foco gerenciado (abrir → 1º campo; fechar → trigger), `font-size ≥16px`, helpers persistentes, validação blur + `aria-invalid`, `enterkeyhint` onde houver input, `prefers-reduced-motion`.

## Consequências

- Positivas: valor imediato sem backend; append-only preservado; RBAC só-UI + RLS real.
- Riscos: Drawer cresce — mitigado com colapsáveis + lazy nas seções pesadas (fotos/mapa ficam p/ ADR-05).

## Escopo

Entra: aba + ficha + evolução + gating + banner. Não entra: wizard (ADR-04), fotos/mapa/termo (ADR-05), pacotes/checkout.

## Arquivos afetados

- `src/app/agenda/AppointmentDrawer.tsx` (4ª aba; TabsList single-row)
- Novo `src/app/agenda/prontuario/*` (FichaAtual, EvolucaoTimeline, BannerAlergia, gating empty/upsell)
- Testes: `*.test.tsx` (aba renderiza, RBAC por papel, gating null-safe, append-only sem update/delete)

## Critérios de aceite (testáveis)

1. 375px: 4 tabs em linha única com scroll horizontal, sem scroll-X da página; 1280px idem sem quebra.
2. Painel inativo tem `hidden`; aba ativa tem underline + `aria-selected`.
3. Receptionist vê banner alergia e NÃO vê ficha/evolução; admin/professional veem tudo (teste por papel).
4. "Corrigir" cria v2, v1 intacta e linkada; nenhum UPDATE/DELETE em `clinical_records` (teste + review de código).
5. Sem entitlement: aba habilitada + upsell alcançável (desvio intencional — ver item 1), dado existente legível, sem crash/rede sensível.
6. Console zero ERROR/WARN; screenshots claro+escuro em `harness/`.

## Dependência

ADR-01 (contrato `prontuario`). Independente de ADR-02.
