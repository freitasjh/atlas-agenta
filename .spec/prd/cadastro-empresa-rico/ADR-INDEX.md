# ADR-INDEX — cadastro-empresa-rico

> Ledger 1:1 com `ADRs/**`: uma linha por ADR; a ordem é a de merge.

| order | id | title | status | depends_on | dir | branch | merge |
|---|---|---|---|---|---|---|---|
| 1 | ADR-001 | Schema tenants: colunas de endereço + NOT NULL documento/phone | todo | — | ADRs/ADR-001-schema-tenants-endereco/ | adr/cadastro-empresa-rico/01-schema-tenants-endereco | — |
| 2 | ADR-002 | RPC create_tenant_with_admin + Edge signup-tenant: params, validação server, 409 documento | todo | ADR-001 | ADRs/ADR-002-rpc-edge-signup/ | adr/cadastro-empresa-rico/02-rpc-edge-signup | — |
| 3 | ADR-003 | UI CadastroPage + validações cliente + ViaCEP com fallback | todo | ADR-002 | ADRs/ADR-003-ui-cadastro-viacep/ | adr/cadastro-empresa-rico/03-ui-cadastro-viacep | — |

> Contrato das colunas (SPEC §4.2): `order` inteiro ≥1 · `status` ∈
> todo|in-progress|merged|dropped · `depends_on` declarado (`—` quando não há) ·
> `dir` = `ADRs/ADR-00N-{slug}/` · `branch` = `adr/{prd-id}/{nn}-{slug}` ·
> `merge` preenchido quando `status=merged`.
> Teto: 3 de 5 ADRs usados. Fora deste ciclo: whatsapp/Evolution, funcionário (fase 2).
