# ADR-00N — <título da decisão>

> Unidade de decisão: 1 ADR = 1 branch = 1 PR (merge humano).
> **Layout por ADR (v2):** com `unit: adr` no `ADR-INDEX.md`, este diretório é a
> unidade de entrega e carrega `ADR.md` + `SPEC.md` + `TASKS.md` (+ `VERIFY.md`
> quando `status: merged`). `unit: legacy` mantém só `ADR.md`.

- **Decisão**: <o que foi decidido, em uma frase>
- **Motivo**: <por que agora; qual dor ele ataca>
- **Alternativas descartadas**: <alternativa> — fonte: https://example.org/alternativa
- **depende-de**: — | ADR-00M
- **Interface congelada**: <contrato que os demais ADRs podem consumir>
- **Fora desta decisão**: <o que NÃO é decidido aqui>
- **Consequências se estiver errado**: <impacto e reversibilidade>
- **Status**: todo | in-progress | merged | dropped
