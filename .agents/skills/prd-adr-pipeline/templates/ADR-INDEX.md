# ADR-INDEX — <prd-id>

> Ledger 1:1 com `ADRs/**`: uma linha por ADR; a ordem é a de merge.
> **Antes de commitar:** toda linha REAL precisa do dir `ADRs/ADR-00N-{slug}/`
> correspondente no disco. A linha de exemplo abaixo está **comentada** (`>`),
> então o `ADR-01` não a lê. Este índice **nasce junto com a 1ª linha real e o
> dir dela**: descomente a linha de exemplo (tirando o `>`) e crie
> `ADRs/ADR-001-exemplo/` no mesmo passo. Um ledger **sem linhas** reprova o
> `ADR-02` — o `ADR-INDEX` só existe para registrar ADRs reais, nunca para
> ficar vazio.

| order | id | title | status | depends_on | dir | branch | merge |
|---|---|---|---|---|---|---|---|
> | 1 | ADR-001 | <título> | todo | — | ADRs/ADR-001-exemplo/ | adr/exemplo/01-exemplo | — |

> Contrato das colunas (SPEC §4.2): `order` inteiro ≥1 · `status` ∈
> todo|in-progress|merged|dropped · `depends_on` declarado (`—` quando não há) ·
> `dir` = `ADRs/ADR-00N-{slug}/` · `branch` = `adr/{prd-id}/{nn}-{slug}` ·
> `merge` preenchido quando `status=merged`.
