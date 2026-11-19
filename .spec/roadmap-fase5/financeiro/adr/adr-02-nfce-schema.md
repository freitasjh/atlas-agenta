# ADR-02 — NFCe schema fiscal (tabelas + RLS + idempotência origem)

- **Status**: `proposed`
- **Depende de**: ADR-01 (gating `nfce` disponível para UI futura; sem ele nada fiscal renderiza escrita).
- **RFs**: RF-02, RF-03, RF-04, RF-40 + fronteiras §7.

## Contexto

NFCe precisa de trilha auditável: documento imutável + eventos de ciclo de vida (emissão, contingência, rejeição, cancelamento, carta). Sem schema não há emissão nem DANFE. Restrições: RLS `tenant_id` do JWT; idempotência por origem (1 NFCe por atendimento/venda, replay sem duplicar nem duplicar receita); XML/DANFE preservados após cancelamento; segredos (certificado/CSC) nunca no cliente.

## Decisão

Duas tabelas, sem Edge ainda:

- `fiscal_documents`: `id, tenant_id, origem_tipo (appointment|sale), origem_id, numero, serie, chave_acesso (unique), status (pendente|autorizada|contingencia|rejeitada|cancelada), valor_cents, xml, danfe_url, created_at, authorized_at` (timestamptz UTC). Unique parcial `(tenant_id, origem_tipo, origem_id)` — 1 documento por origem.
- `fiscal_events`: `id, tenant_id, fiscal_document_id FK composta (tenant_id, id), tipo, motivo, payload jsonb, created_by, created_at`. Append-only (sem update/delete cliente; service_role escreve).
- RLS: tenant lê/escreve próprios; `admin`-only via policy (recepção/profissional sem acesso — 403 + RLS nega); service_role bypass para emissor futuro.
- `valor_cents` snapshot da origem (não recalcula receita; emissão nunca toca `appointment_payments`).

## Consequências

- Positivas: emissão futura é insert idempotente; auditoria completa; cancelamento preserva XML.
- Negativas: sem emissor, tabela nasce sem linhas — UI lista vazia (empty state). Sem problema: ADR-03 consome.
- Riscos: `chave_acesso` só existe pós-autorização → nullable até autorizar; unicidade origem cobre idempotência antes disso.

## Escopo

- Entra: migration + RLS/policies + índices + seed de teste + RPC leitura lista (ou PostgREST direto RLS).
- Não entra: emissor SEFAZ/provedor, DANFE geração, UI, cancelamento RPC (ADR-03).

## Arquivos afetados

- `supabase/migrations/*_fiscal_documents.sql`
- `supabase/functions/_shared/fiscal.ts` (tipos/validação zod origem — sem segredo)
- `src/lib/fiscal.ts` (tipos leitura + queries RLS; sem escrita privilegiada)

## Critérios de aceite (testáveis)

1. `supabase db reset` aplica sem erro; RLS: tenant A não lê documentos do B (0 linhas); anon sem JWT → 0.
2. Insert duplicado mesma origem → violação unique (1 linha); replay idempotente comprovado por teste integração.
3. `*_cents` inteiro; timestamps UTC; `cancelada` mantém `xml` não-nulo.
4. Suite `npm test` verde; sem segredo no bundle (grep `CSC|certificado` em `src/` → 0 hits fora de teste mock).
