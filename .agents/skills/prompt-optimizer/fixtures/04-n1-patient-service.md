---
esperado: rota-b
---

# N+1 na listagem de pacientes

Eliminar as N+1 queries de `PatientService.list()` — hoje cada paciente dispara uma consulta extra de endereço. Escopo: só o repositório e o service do módulo `patient`; não alterar o DTO de resposta nem o frontend. Usar `@EntityGraph` com `distinct`, sem mudar a paginação existente. Bugfix. Pronto quando `mvn verify -pl integration-test` passar com um teste que conta queries e confirma uma única busca de endereços para 50 pacientes, com o payload inalterado.

## Veredito esperado (contrato — não é o prompt)

E1 ✅ · E2 ✅ · E3 ✅ · E4 ✅ · E5 ✅ · E6 ✅ → Rota B.
