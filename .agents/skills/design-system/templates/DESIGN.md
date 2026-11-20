# DESIGN.md — template a copiar/adaptar no destino

> **Template.** Copie para a raiz do projeto de destino e preencha com os tokens
> reais daquele projeto. Os valores em `profiles/*/tokens/**` são exemplos
> ilustrativos portados do harness de referência — **não são prescrição de marca**.
> Fonte visual mandatória: o `DESIGN.md`/tokens do **destino**, nunca este template.

## Contrato

1. **Fonte única**: `tokens/*.json` em formato DTCG (`$value` + `$type`; alias `{grupo.token}`).
   Hex cru só vive em `tokens/`. Componentes consomem **somente tokens semânticos**.
2. **Pipeline**: tokens → primitivos → blocos → telas. Nenhum nível pula o anterior.
3. **Gerar CSS** via `scripts/build-tokens.mjs` → `src/tokens-generated.css`; a entrada
   global importa o CSS gerado e nunca hardcoded tema.
4. **Modo escuro** por classe `.dark` (shadcn) ou `data-theme` (editorial) — escolha
   do destino, documentada aqui.
5. **Gate** pós-edição em `src/`: `bash scripts/verify.sh`
   (tokens → lint → tipos → testes → build).

## Matriz de estados (todo componente interativo)

| Estado | requisito |
|---|---|
| default | aparência base vinda de token |
| hover | feedback visual, sem trocar token semântico |
| focus | ring visível (`--ring`), contraste ≥3:1 |
| active | pressed |
| disabled | não-interativo, `aria-disabled`, contraste reduzido |
| loading | skeleton/spinner, `aria-busy` |
| error | borda `--destructive`, mensagem, `aria-invalid` |
| empty | placeholder + CTA de ação |
| success | confirmação visual |

Story por estado antes da página — ver skill `storybook`.

## Anti-slop (obrigatório)

- Sem grid simétrica genérica de 3 colunas; composição assimétrica quando couber.
- Sem gradiente roxo/azul néon, sombra escura densa, branco cru estéril como piso.
- Vidro só em chrome (nav/toolbar), com fallback sólido; conteúdo em superfície sólida.
- Tipografia: escala com tracking negativo no display; alvo de toque ≥44px no mobile;
  respeitar `prefers-reduced-motion`.
- Elevação: 1 token de cor + 1 token de sombra. Nada de "visual gerado por IA".

## Checklist de adoção no destino

- [ ] Copiar `profiles/<perfil>/DESIGN.md` → `<destino>/DESIGN.md` e editar com a marca real.
- [ ] Copiar `profiles/<perfil>/tokens/**` → `<destino>/tokens/**` e substituir valores.
- [ ] Rodar `build-tokens.mjs` e commitar o CSS gerado.
- [ ] Auditar: `node scripts/validate.mjs --target <destino>`.
