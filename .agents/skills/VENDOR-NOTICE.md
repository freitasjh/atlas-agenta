# VENDOR-NOTICE

Vendor de skills de terceiros do harness. Gerado por `scripts/vendor-skills.mjs`.
Politica de licenca P-02=(i): skill sem licenca identificavel NAO e vendorizada (fail-closed).
O vendor copia cada skill do source-lock de entrada; o `--check` recomputa o treeHash das skills e o sha dos arquivos de licenca agregados e FALHA em qualquer drift contra o lock commitado (o lock e a referencia de integridade do CI).
A procedencia da LICENCA varia por FONTE (`licenseOrigin`): `upstream-file` = sha do arquivo de licenca REAL do upstream no commit pinado; `declared-evidence` = licenca declarada por evidencia citada (`evidence[]`) e sha do NOSSO texto transcrito.

## Fontes (proveniencia)

| source | sourceType | sourceCommit | SPDX | licenseOrigin | licenseFile (agregado) |
|---|---|---|---|---|---|
| dart-lang/skills | github | 0d9f1c4a0ae29d6f5180bf6143d7997ec3bacf49 | BSD-3-Clause | upstream-file | LICENSE-dart-lang-skills |
| flutter/skills | github | 0ef3972f93e2baa4156ba1cbb1e515cd53079c68 | BSD-3-Clause | upstream-file | LICENSE-flutter-skills |
| vercel-labs/agent-skills | github | 063bee94c3f4df8453406c830b0a7df0f2860278 | MIT | declared-evidence | LICENSE-vercel-agent-skills |
| Kadajett/agent-nestjs-skills | github | 3986e0cede33958e000f959031cbee0cd83c2941 | MIT | declared-evidence | LICENSE-kadajett-agent-nestjs-skills |
| google-labs-code/stitch-skills | github | 0337446dadde6f8c94210444e2aa9d546126480f | Apache-2.0 | upstream-file | LICENSE-stitch-skills |

## Licencas (texto completo + copyright)

Cada licenca abaixo foi escrita na raiz deste diretorio como arquivo agregado
(o `licenseFile` da fonte). A ORIGEM do texto e declarada por fonte:

### dart-lang/skills — BSD-3-Clause (`LICENSE-dart-lang-skills`)

Origem `upstream-file`: texto byte-identico ao arquivo de licenca do repo upstream no commit pinado (o `--check` recomputa o sha256 e falha em drift).

```text
Copyright 2012, the Dart project authors.

Redistribution and use in source and binary forms, with or without modification,
are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its contributors
   may be used to endorse or promote products derived from this software without
   specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR
ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
(INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON
ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

### flutter/skills — BSD-3-Clause (`LICENSE-flutter-skills`)

Origem `upstream-file`: texto byte-identico ao arquivo de licenca do repo upstream no commit pinado (o `--check` recomputa o sha256 e falha em drift).

```text
Copyright 2026 The Flutter Authors. All rights reserved.

Redistribution and use in source and binary forms, with or without modification,
are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its contributors
   may be used to endorse or promote products derived from this software without
   specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR
ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
(INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON
ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

### google-labs-code/stitch-skills — Apache-2.0 (`LICENSE-stitch-skills`)

Origem `upstream-file`: texto byte-identico ao arquivo de licenca do repo upstream no commit pinado (o `--check` recomputa o sha256 e falha em drift).

```text
                                 Apache License
                           Version 2.0, January 2004
                        http://www.apache.org/licenses/

   TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

   1. Definitions.

      "License" shall mean the terms and conditions for use, reproduction,
      and distribution as defined by Sections 1 through 9 of this document.

      "Licensor" shall mean the copyright owner or entity authorized by
      the copyright owner that is granting the License.

      "Legal Entity" shall mean the union of the acting entity and all
      other entities that control, are controlled by, or are under common
      control with that entity. For the purposes of this definition,
      "control" means (i) the power, direct or indirect, to cause the
      direction or management of such entity, whether by contract or
      otherwise, or (ii) ownership of fifty percent (50%) or more of the
      outstanding shares, or (iii) beneficial ownership of such entity.

      "You" (or "Your") shall mean an individual or Legal Entity
      exercising permissions granted by this License.

      "Source" form shall mean the preferred form for making modifications,
      including but not limited to software source code, documentation
      source, and configuration files.

      "Object" form shall mean any form resulting from mechanical
      transformation or translation of a Source form, including but
      not limited to compiled object code, generated documentation,
      and conversions to other media types.

      "Work" shall mean the work of authorship, whether in Source or
      Object form, made available under the License, as indicated by a
      copyright notice that is included in or attached to the work
      (an example is provided in the Appendix below).

      "Derivative Works" shall mean any work, whether in Source or Object
      form, that is based on (or derived from) the Work and for which the
      editorial revisions, annotations, elaborations, or other modifications
      represent, as a whole, an original work of authorship. For the purposes
      of this License, Derivative Works shall not include works that remain
      separable from, or merely link (or bind by name) to the interfaces of,
      the Work and Derivative Works thereof.

      "Contribution" shall mean any work of authorship, including
      the original version of the Work and any modifications or additions
      to that Work or Derivative Works thereof, that is intentionally
      submitted to Licensor for inclusion in the Work by the copyright owner
      or by an individual or Legal Entity authorized to submit on behalf of
      the copyright owner. For the purposes of this definition, "submitted"
      means any form of electronic, verbal, or written communication sent
      to the Licensor or its representatives, including but not limited to
      communication on electronic mailing lists, source code control systems,
      and issue tracking systems that are managed by, or on behalf of, the
      Licensor for the purpose of discussing and improving the Work, but
      excluding communication that is conspicuously marked or otherwise
      designated in writing by the copyright owner as "Not a Contribution."

      "Contributor" shall mean Licensor and any individual or Legal Entity
      on behalf of whom a Contribution has been received by Licensor and
      subsequently incorporated within the Work.

   2. Grant of Copyright License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      copyright license to reproduce, prepare Derivative Works of,
      publicly display, publicly perform, sublicense, and distribute the
      Work and such Derivative Works in Source or Object form.

   3. Grant of Patent License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      (except as stated in this section) patent license to make, have made,
      use, offer to sell, sell, import, and otherwise transfer the Work,
      where such license applies only to those patent claims licensable
      by such Contributor that are necessarily infringed by their
      Contribution(s) alone or by combination of their Contribution(s)
      with the Work to which such Contribution(s) was submitted. If You
      institute patent litigation against any entity (including a
      cross-claim or counterclaim in a lawsuit) alleging that the Work
      or a Contribution incorporated within the Work constitutes direct
      or contributory patent infringement, then any patent licenses
      granted to You under this License for that Work shall terminate
      as of the date such litigation is filed.

   4. Redistribution. You may reproduce and distribute copies of the
      Work or Derivative Works thereof in any medium, with or without
      modifications, and in Source or Object form, provided that You
      meet the following conditions:

      (a) You must give any other recipients of the Work or Derivative
      Works a copy of this License; and

      (b) You must cause any modified files to carry prominent notices
      stating that You changed the files; and

      (c) You must retain, in the Source form of any Derivative Works
      that You distribute, all copyright, patent, trademark, and
      attribution notices from the Source form of the Work,
      excluding those notices that do not pertain to any part of
      the Derivative Works; and

      (d) If the Work includes a "NOTICE" text file as part of its
      distribution, then any Derivative Works that You distribute must
      include a readable copy of the attribution notices contained
      within such NOTICE file, excluding those notices that do not
      pertain to any part of the Derivative Works, in at least one
      of the following places: within a NOTICE text file distributed
      as part of the Derivative Works; within the Source form or
      documentation, if provided along with the Derivative Works; or,
      within a display generated by the Derivative Works, if and
      wherever such third-party notices normally appear. The contents
      of the NOTICE file are for informational purposes only and
      do not modify the License. You may add Your own attribution
      notices within Derivative Works that You distribute, alongside
      or as an addendum to the NOTICE text from the Work, provided
      that such additional attribution notices cannot be construed
      as modifying the License.

      You may add Your own copyright statement to Your modifications and
      may provide additional or different license terms and conditions
      for use, reproduction, or distribution of Your modifications, or
      for any such Derivative Works as a whole, provided Your use,
      reproduction, and distribution of the Work otherwise complies with
      the conditions stated in this License.

   5. Submission of Contributions. Unless You explicitly state otherwise,
      any Contribution intentionally submitted for inclusion in the Work
      by You to the Licensor shall be under the terms and conditions of
      this License, without any additional terms or conditions.
      Notwithstanding the above, nothing herein shall supersede or modify
      the terms of any separate license agreement you may have executed
      with Licensor regarding such Contributions.

   6. Trademarks. This License does not grant permission to use the trade
      names, trademarks, service marks, or product names of the Licensor,
      except as required for reasonable and customary use in describing the
      origin of the Work and reproducing the content of the NOTICE file.

   7. Disclaimer of Warranty. Unless required by applicable law or
      agreed to in writing, Licensor provides the Work (and each
      Contributor provides its Contributions) on an "AS IS" BASIS,
      WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
      implied, including, without limitation, any warranties or conditions
      of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A
      PARTICULAR PURPOSE. You are solely responsible for determining the
      appropriateness of using or redistributing the Work and assume any
      risks associated with Your exercise of permissions under this License.

   8. Limitation of Liability. In no event and under no legal theory,
      whether in tort (including negligence), contract, or otherwise,
      unless required by applicable law (such as deliberate and grossly
      negligent acts) or agreed to in writing, shall any Contributor be
      liable to You for damages, including any direct, indirect, special,
      incidental, or consequential damages of any character arising as a
      result of this License or out of the use or inability to use the
      Work (including but not limited to damages for loss of goodwill,
      work stoppage, computer failure or malfunction, or any and all
      other commercial damages or losses), even if such Contributor
      has been advised of the possibility of such damages.

   9. Accepting Warranty or Additional Liability. While redistributing
      the Work or Derivative Works thereof, You may choose to offer,
      and charge a fee for, acceptance of support, warranty, indemnity,
      or other liability obligations and/or rights consistent with this
      License. However, in accepting such obligations, You may act only
      on Your own behalf and on Your sole responsibility, not on behalf
      of any other Contributor, and only if You agree to indemnify,
      defend, and hold each Contributor harmless for any liability
      incurred by, or claims asserted against, such Contributor by reason
      of your accepting any such warranty or additional liability.

   END OF TERMS AND CONDITIONS

   APPENDIX: How to apply the Apache License to your work.

      To apply the Apache License to your work, attach the following
      boilerplate notice, with the fields enclosed by brackets "[]"
      replaced with your own identifying information. (Don't include
      the brackets!)  The text should be enclosed in the appropriate
      comment syntax for the file format. We also recommend that a
      file or class name and description of purpose be included on the
      same "printed page" as the copyright notice for easier
      identification within third-party archives.

   Copyright [yyyy] [name of copyright owner]

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.
```

### vercel-labs/agent-skills — MIT (`LICENSE-vercel-agent-skills`)

Origem `declared-evidence`: o upstream NAO publica arquivo de licenca; o texto foi TRANSCRITO por nos e o `--check` valida o sha do NOSSO texto. A fidelidade da transcricao e 🟡 processo (evidencia citada), NAO garantia de runtime.

Evidencia:
- https://github.com/vercel-labs/agent-skills/blob/063bee94c3f4df8453406c830b0a7df0f2860278/skills/react-best-practices/SKILL.md — frontmatter: license: MIT (metadata.author: vercel) (commit `063bee94c3f4df8453406c830b0a7df0f2860278`)
- https://github.com/vercel-labs/agent-skills/blob/063bee94c3f4df8453406c830b0a7df0f2860278/README.md — ## License -> MIT (commit `063bee94c3f4df8453406c830b0a7df0f2860278`)
- https://github.com/vercel-labs/agent-skills/blob/063bee94c3f4df8453406c830b0a7df0f2860278/packages/react-best-practices-build/package.json — "license": "MIT" (commit `063bee94c3f4df8453406c830b0a7df0f2860278`) — holder 'Vercel, Inc.' atribuido do author/organization declarados upstream (🟡 processo)

```text
MIT License

Copyright (c) Vercel, Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Skills vendorizadas (24)

| skill | source | stacks | optional | computedHash | treeHash |
|---|---|---|---|---|---|
| dart-add-unit-test | dart-lang/skills | dart | - | 326a2b6cb57bcb4f40203e063a1060e9549a8cea0ece1a5c9a0d39a2f2b85bc8 | ca966dcf20f38b27ef6fc48a55b8c27cb7705127e03b7a5c78d36ea146fc266e |
| dart-build-cli-app | dart-lang/skills | dart | - | 2c693ba718e23155fd9acd8d2e14f5c311258ed900131b2ad12fda46ae5eebfa | 9c88873c3404f2afa386ef9e9c7dd181c052ced38aa1b8e9f4814c685a49c5a5 |
| dart-collect-coverage | dart-lang/skills | dart | - | 36d77c4ebc2edc7ade399ae8461776dd33a461899afda4b2b9d8e7f599d2ef6c | fca566d09e82d45c7acbd8c4e85a38487c0f813b7919893f4bc7066ca03a33f2 |
| dart-fix-runtime-errors | dart-lang/skills | dart | - | 7b13cb0df76693d8c798432a1f86325b093a35e9687f231a012763fcad54fb2c | 5e389fb7035cc36177318dfccaf047eaf222946930f0e24844ab1281a9601800 |
| dart-generate-test-mocks | dart-lang/skills | dart | - | 7bf12a98d63e96ed51ba077a24426be1b11a9fc508f7dfca60fc6e118c3fc923 | c8a6732810c81d861aae6eacea0e02097942f752dc9f63ea318aa838253cc729 |
| dart-migrate-to-checks-package | dart-lang/skills | dart | - | 00b7fa026dcf004421650f20147d020244886321f715ff57ee38a96b3a9945bc | 601c6e0201db0ed1b92a5fb3f21e65e97dcc0b4ce420e4a2036ef46e20d60d53 |
| dart-resolve-package-conflicts | dart-lang/skills | dart | - | e25c789387152d9d0c437610caa5746e337a789bcb8e9c9887b0425b94b734ef | e21ffd909306c9d7e0d9a9a207e4383c8c372c9e080ed9b23ffdff822b8f86f4 |
| dart-run-static-analysis | dart-lang/skills | dart | - | e64ea092e216ecdc9b4a8b49b06d0b9a0b49f680c1116ada1d247b2de3fa6fe1 | e2a7454ac22d69d6c6ccb3d1c4c5e2da56c846d0a4c9699bbd33827936bec4f4 |
| dart-setup-ffi-assets | dart-lang/skills | dart | - | c27f5a4e79a4f291e09a9cfeab2842bb04d3570bb64c56bf309e573c3f244ef8 | ae72ba6a8253362a100d31d471ad70e9bae0128e8150b1541dedaafb3209cb81 |
| dart-use-ffigen | dart-lang/skills | dart | - | 688ec3e0218b3a96437916be5bdcaea87fe4f90ba869c3deec2f3392f1c6b626 | d0f26d683f54589a6c44bf599d5c37dd4862c7d2a9befe6862167c421355fec8 |
| dart-use-pattern-matching | dart-lang/skills | dart | - | 86ea49e8f82ebcdbfd00579c0bcaca16d3f33839c96f9d3875bee95c553daa4b | 08dcca251379e52a84ec7b2206518208c563b86ab72f29056ff2c54619d6ebe1 |
| dart-use-primary-constructors | dart-lang/skills | dart | - | 7cf85926f3de62ed9357d4f1f58da3762ebba5850308945a4836114e6ac0b048 | 0f919b00d2f9b57cb27207782888feb2c9117f3b2b5466bd63a159ca4f20be78 |
| flutter-add-integration-test | flutter/skills | flutter | - | 9ead37fef54371fed6ad07a9ba3de7a908135a0867b05baf74c28b7095343999 | 62eb6600a25156b09012ff5c1b5897fc4e02e9dbb1a1a8d3bc80fbce0d8fb345 |
| flutter-add-widget-preview | flutter/skills | flutter | - | 1b59c009558aab7a8e4b7b101fbe535b06054c0672780e9cea7e5c98a9c48dc4 | d015fd19a06b7c9f42e65add3e90fd51095cd6cb11f2b57c5d6bf759483b4f9a |
| flutter-add-widget-test | flutter/skills | flutter | - | c4f263c59cfe331ef42dba2aa81e25142aa4f7284518907c6b847e04502676b0 | bc03a884d80821350ce6298b0f528e27af1fe70733f8d8717fb84129750666b6 |
| flutter-apply-architecture-best-practices | flutter/skills | flutter | - | 2b1b63214d6b153c50aacd4bbcb76ce91dece449de9e06f477f8aad3163d667f | 7d8ae28831dcf0bf1d5968e0ef79218e2994d68f2463a5ef1e96f4c51c77b489 |
| flutter-build-responsive-layout | flutter/skills | flutter | - | f762ea2ee83d4f1f35d9093b41d2520dd024ab80c9539d4860b9ae7f2a4dc6a0 | f77247468631edb171477f808da95151dd19ce0164001ca57df3e38f912be6b2 |
| flutter-fix-layout-issues | flutter/skills | flutter | - | 1aaba922c951159118f9b141788f7bb7b8167bdc0bd5c6f0738ebb90c29b9532 | 85570f8ea12d4e1f3a2b2d6622c51b144a4df2697779633e67c2c23558f5946c |
| flutter-implement-json-serialization | flutter/skills | flutter | - | 0eed26f25308d78c6a9036ec936db93342f064d64f2cbac5e0e8648ba6b9db3f | 4a3198b5f1949c9bb5fc72466373b23ca7cf3b32ab92a44af51f2dec0348d49a |
| flutter-setup-declarative-routing | flutter/skills | flutter | - | 2341440c8bce0f176663695eaa71f9f7d7c967772a1dcd0d833c9778504b227e | 7d9c8b9d144b4064886b497b62968627fab7615e441fc67d95bfec7fc50e5c4a |
| flutter-setup-localization | flutter/skills | flutter | - | 671bf254ca8f3172b6bda5287d9e756e9fd5b49165a815f710c5b707ebaa38f8 | 33bfbdfb46d39c2acba559ab0b1b8d28a51c6a7ff3f6e0367f3b3cd46086cc92 |
| flutter-use-http-package | flutter/skills | flutter | - | 17efcf4da9933afaf9c1d41940bd6b92f1ae73dcae4bf6c59cfe24f7e487ee9f | 7400a1e1f5424fd85a99e1d57dc1946761e4768a0c3ac5accf20d2e896ba03c1 |
| react-best-practices | vercel-labs/agent-skills | react | - | 3219a1944e404ffc14d1d9d6aef6dd2e3855b81387ee0a044ccbfe14d34c2357 | dd9d1fda97727eff044b0482735ed8b08adfd31957afc8248ce19ba87732b0be |
| react-components | google-labs-code/stitch-skills | react | true | e4f9aaccf174f414274873cbeeee1bb6fa8833ae50457246d670872b0c3e063a | 3e49f53f8d51c9732d4501e6e86711dbd874868b72521297ee478cf76d34fb69 |

## Skills opcionais (1)

`optional` e METADADO DE PROCEDENCIA (RF-09/D-3): a skill SEGUE instalada no
destino do seu eixo — o campo declara dependencia EXTERNA declarada na origem,
nao "nao instalar".

| skill | source | dependencias externas declaradas |
|---|---|---|
| react-components | google-labs-code/stitch-skills | rede em runtime: scripts/fetch-stitch.sh (curl em URL do Stitch); @swc/core (scripts/validate.js faz parse AST); Stitch MCP (allowed-tools stitch*:*) |

## Skills excluidas (0)

| skill | motivo |
|---|---|

## Revisao de conteudo (S1/S4)

Arquivos vendorizados: 109. Conteudo executavel: 4. Symlinks: 0.

| skill | arquivo |
|---|---|
| react-components | examples/gold-standard-card.tsx |
| react-components | resources/component-template.tsx |
| react-components | scripts/fetch-stitch.sh |
| react-components | scripts/validate.js |

## Build do vendor (RF-13 — source-side, nunca no instalador)

Source-lock de entrada COMMITADO: `scripts/vendor/skills-lock.json` (declara `stacks`, `optional` e `runtimeDeps` por skill — evidencia auditavel).
Reproducao: clonar cada fonte no commit pinado (tabela de fontes acima), expor cada
skill como `<stage>/<nome-da-skill>` e rodar:

```sh
node scripts/vendor-skills.mjs --source <stage> --lock scripts/vendor/skills-lock.json \
  --source-commit <source>=<sha>   # um por fonte, pinado
```

O `--check` roda no CI SEM rede nem clones: o lock commitado e a evidencia.

### Kadajett/agent-nestjs-skills — MIT (`LICENSE-kadajett-agent-nestjs-skills`)

Origem `declared-evidence`: o upstream NAO publica arquivo de licenca; o texto foi TRANSCRITO por nos e o `--check` valida o sha do NOSSO texto. A fidelidade da transcricao e 🟡 processo (evidencia citada), NAO garantia de runtime.

Evidencia:
- https://github.com/Kadajett/agent-nestjs-skills/blob/3986e0cede33958e000f959031cbee0cd83c2941/skills/nestjs-best-practices/SKILL.md — frontmatter: license: MIT (metadata.author: Kadajett) (commit `3986e0cede33958e000f959031cbee0cd83c2941`)
- https://github.com/Kadajett/agent-nestjs-skills/blob/3986e0cede33958e000f959031cbee0cd83c2941/README.md — Installation / Supported Agents (OpenCode listed) (commit `3986e0cede33958e000f959031cbee0cd83c2941`)

```text
MIT License

Copyright (c) 2026 Kadajett

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Limites declarados

- Rede em RUNTIME dentro de skill opcional (`scripts/fetch-stitch.sh`, `@swc/core`, Stitch MCP) NAO e cacada pelo V15 (escopo `installer/`): 🟠 parcial, declarado.
- Fidelidade da transcricao das fontes `declared-evidence` e 🟡 processo (evidencia citada), nao garantia de runtime.
- Fidelidade byte-a-byte da COPIA DA SKILL ao commit pinado e 🟡 PROCESSO: verificada na vendorizacao e NAO re-verificada pelo `--check` (que compara com o lock commitado).
  Divergencia CONHECIDA e NAO corrigida em 3 skill(s): o `sourceCommit` declarado NAO descreve o conteudo delas — a copia veio de outra revisao e foi preservada para nao alterar os hashes congelados do lock (invariante I5 do ciclo).

  | skill | sourceCommit declarado | revisao real do conteudo | divergencia vs o pin |
  |---|---|---|---|
  | dart-add-unit-test | 0d9f1c4a0ae29d6f5180bf6143d7997ec3bacf49 | 19228e842c691a5bcdb06b6603f3651953b2af2a | difere do pin em 1 linha de metadata (`last_modified`); os demais bytes sao identicos |
  | dart-build-cli-app | 0d9f1c4a0ae29d6f5180bf6143d7997ec3bacf49 | 19228e842c691a5bcdb06b6603f3651953b2af2a | revisao anterior: `SKILL.md` difere e faltam 4 arquivos presentes no pin (`examples/multi_command_runner.dart`, `examples/single_command_tool.dart`, `references/aot_sdk_discovery.md`, `references/signals_and_terminal.md`) |
  | dart-use-pattern-matching | 0d9f1c4a0ae29d6f5180bf6143d7997ec3bacf49 | 19228e842c691a5bcdb06b6603f3651953b2af2a | revisao anterior: `SKILL.md` difere e falta 1 arquivo presente no pin (`examples/json_patterns.dart`) |
- `.agents/skills/**` esta fora do scan dos canarios (`scripts/static-checks.mjs`, repo de origem; não existe neste repo).
