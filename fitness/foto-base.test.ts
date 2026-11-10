// Fitness function: prompts e saídas do CLI da rodada I-263.R2 contra a foto da base anterior (7ce3c2f, o merge do PR
// #115, pai do primeiro commit da rodada). O gerador roda aqui, no código atual, e o resultado tem de ser a foto da base
// com só as trocas declaradas abaixo. Veja fitness/foto-base/LEIAME.md.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, test } from "node:test";

const PASTA_DA_FOTO = resolve(import.meta.dirname, "foto-base");
const PASTA_DA_FOTO_DA_BASE = join(PASTA_DA_FOTO, "base");
const PASTA_DA_FOTO_ATUAL = mkdtempSync(join(tmpdir(), "fabriquinha-foto-atual-"));
after(() => {
  rmSync(PASTA_DA_FOTO_ATUAL, { recursive: true, force: true });
});

/** Uma diferença intencional: o trecho `de`, na foto da base, vira `para` na foto atual. */
interface DiferencaIntencional {
  arquivo: string;
  de: string;
  para: string;
  motivo: string;
}

const MOTIVO_BRANCH_BASE_COM_NOME_DO_CAMPO = "I-269.R4: o texto cita o campo do projeto pelo nome novo, branch_base";
const MOTIVO_ARQUIVOS_PREVISTOS =
  "I-280.R1: o campo `caminhos` do ticket passa a se chamar `arquivos_previstos`, o mesmo nome dos três níveis do plano";
const MOTIVO_TRES_NIVEIS =
  "I-280.R1: o plano prevê `arquivos_previstos` na demanda, na rodada e no ticket (Ticket ⊆ Rodada ⊆ Demanda), e mudança de rumo é correção do Plano";
const TRES_NIVEIS_NO_PLANEJAR =
  "   Os arquivos previstos existem em três níveis: `arquivos_previstos` na demanda, em cada rodada e em cada ticket. Todo arquivo previsto do ticket está na sua rodada e todo arquivo previsto da rodada está na demanda (Ticket ⊆ Rodada ⊆ Demanda); o plano que viola isso é recusado na submissão, com o arquivo e o nível no motivo.\n   Depois da aprovação não há replanejamento: mudança de rumo é correção do Plano, nunca um plano novo.\n";
const MOTIVO_NOME_NOVO = "o fluxo de issues foi desligado (cutover de 2026-10-28), e o texto passa a falar de demanda";
const MOTIVO_REVISOES_ANTERIORES =
  "I-294: a revisar_rodada recebe as revisões anteriores da rodada e confere primeiro os motivos, sem reabrir o decidido";
const PASSOS_DO_REVISAR_RODADA_DA_BASE =
  "2. Confira o código da worktree contra o plano e contra cada critério citado.\n3. Explique o resultado de cada fitness function, inclusive as que falharam.\n4. Comprove cada critério da rodada com o que você viu no código e nos testes.\n5. Depois";
const PASSOS_DO_REVISAR_RODADA_COM_REVISOES_ANTERIORES =
  '2. Confira primeiro, na seção "Revisões anteriores da rodada", se cada motivo anterior foi resolvido e se o diff dos tickets corretivos (`git log --grep` do endereço de cada um) regrediu algo. O que uma revisão anterior ou o Auditor já decidiu, inclusive nas respostas às perguntas listadas, não se reabre: não pergunte de novo nem reprove por isso. Isso não impede reprovar de novo um motivo anterior que continua sem correção: se o corretivo não o resolveu, reprove e registre o motivo.\n3. Confira o código da worktree contra o plano e contra cada critério citado.\n4. Explique o resultado de cada fitness function, inclusive as que falharam.\n5. Comprove cada critério da rodada com o que você viu no código e nos testes.\n6. Depois';
// Otimização do ciclo da demanda (2026-11-07): estresse só quando o diff toca carga, rodadas em cadeia juntas no plano e
// revisões que usam as verificações que a Fabriquinha já fez no commit, sem esperar com sleep.
const MOTIVO_ESTRESSE_SO_NA_CARGA = "otimização: `npm run estresse` só roda quando o diff toca carga ou concorrência";
const MOTIVO_RODADAS_EM_CADEIA =
  "otimização: o plano junta as rodadas em cadeia pura e deixa as independentes em paralelo";
const MOTIVO_VERIFICACOES_JA_FEITAS =
  "otimização: a revisão usa os testes, as fitness e o Sonar que a Fabriquinha já rodou no commit, sem sleep de espera";
const LINHA_DO_ESTRESSE =
  "   Só rode o estresse do projeto se o diff tocar carga ou concorrência; na Fabriquinha, `npm run estresse` só roda se o diff tocar `estresse/`, `src/entrega/http/`, `src/entrega/cli/`, `src/armazenamento/`, `src/infra/`, `src/composicao/` ou os condutores do agendador e das execuções (`src/aplicacao/despacho.ts`, `execucao_demanda.ts`, `gerente.ts`, `sessoes_demanda.ts`, `fechamento_ticket.ts`).";
const USE_AS_VERIFICACOES_JA_FEITAS =
  ' Na seção "Verificações já feitas", veja o que a Fabriquinha já rodou no commit da worktree: código igual ao verificado não roda de novo os mesmos comandos (`npm run check`, integração, e2e).';
const SECAO_VERIFICACOES_JA_FEITAS =
  "## Verificações já feitas\n\nA Fabriquinha rodou estas verificações no commit de cada ticket abaixo, antes de commitá-lo. Se `git rev-parse HEAD^{tree}` na worktree é igual a `git rev-parse <sha>^{tree}` de um deles e `git status --porcelain` está vazio, o código é o verificado: use estes resultados e logs, sem rodar de novo os comandos listados.\n\n(nenhuma)\n\n";
const PASSO_4_DO_PLANEJAR =
  "4. Monte o plano: rodadas com os critérios que cada uma atende, tickets de implementação com dependências e caminhos.\n";
const PERMISSAO_DO_IMPLEMENTAR =
  "   Docker, containers e deploy de teste estão liberados para isso; não peça permissão.\n";
const PASSO_3_DO_REVISAR_DEMANDA =
  "3. Exercite o que a demanda entrega sob carga e entradas extremas e registre o que quebrou ou aguentou.\n";
const emPromptETexto = (etapa: string) => [`prompts/${etapa}.txt`, `textos/src/execucao/etapas/${etapa}.md.txt`];
const MOTIVO_CORRECAO_MUDA_ARQUIVO =
  "I-295: cada correção do --correcoes pede mudança em arquivos da worktree, pois o implementar sem alteração é devolvido";
// I-267.R1: Demanda, Rodada e Ticket passam a ter `estado` (no lugar de `fase` e `status`) com o nome da Etapa, e a etapa
// `sessao_em_aberto` vira `ajustar_resultado`. A foto da base é a de antes da rodada; os nomes novos entram aqui.
const MOTIVO_ESTADO_COM_NOME_DA_ETAPA =
  "I-267.R1: fase e status viram estado, com o nome da Etapa corrente (fase desenvolvimento vira estado implementar)";
const MOTIVO_GATE_REPROVA = "I-272: o vocabulário do gate é aprovar ou reprovar";
const MOTIVO_VEREDITO_DO_PARECER =
  "I-277: o parecer fala em veredito (atende ou nao_atende), derivado dos dados pela Fabriquinha";
const MOTIVO_ETAPA_RENOMEADA = "I-267.R1: a etapa sessao_em_aberto passa a se chamar ajustar_resultado";
/** O arquivo da foto da base que passa a ter outro nome na foto atual. */
const ARQUIVOS_RENOMEADOS: Readonly<Record<string, string>> = {
  "prompts/sessao_em_aberto.txt": "prompts/ajustar_resultado.txt",
  "textos/src/execucao/etapas/sessao_em_aberto.md.txt": "textos/src/execucao/etapas/ajustar_resultado.md.txt",
};
const PROMPTS_DA_BASE = [
  "implementar",
  "planejar",
  "encerrar_demanda",
  "sessao_em_aberto",
  "resolver_conflito",
  "revisar_rodada",
  "encerrar_rodada",
  "revisar_demanda",
].map((etapa) => `prompts/${etapa}.txt`);
const DIFERENCAS_INTENCIONAIS: readonly DiferencaIntencional[] = [
  ...(
    [
      ['"devolucoes":0,"evidencias"', '"evidencias"'],
      [',"devolucoes":0}', "}"],
    ] as const
  ).map(([de, para]) => ({
    arquivo: "cli/aula-e-demanda.txt",
    de,
    para,
    motivo: "I-270: Tentativas guardam os resultados; o ticket público deixa de imprimir o contador removido",
  })),
  {
    arquivo: "textos/src/execucao/avaliacao.md.txt",
    de: "etapas, devoluções e reprovações.",
    para: "etapas, exigências de alteração (`exigenciasDeAlteracao`, as Tentativas reprovadas) e reprovações.",
    motivo: "I-270: o metricas.json da avaliação conta Tentativas reprovadas, em vez do contador removido",
  },
  ...PROMPTS_DA_BASE.map((arquivo) => ({
    arquivo,
    de: "(fase desenvolvimento)",
    para: "(estado implementar)",
    motivo: MOTIVO_ESTADO_COM_NOME_DA_ETAPA,
  })),
  {
    arquivo: "prompts/sessao_em_aberto.txt",
    de: "(etapa sessao_em_aberto)",
    para: "(etapa ajustar_resultado)",
    motivo: MOTIVO_ETAPA_RENOMEADA,
  },
  ...(
    [
      ['"fase":"planejamento","fase_alterada_em"', '"estado":"planejar","estado_alterado_em"'],
      ['"fase":"revisao","e2e"', '"estado":"revisar_rodada","estado_alterado_em":"<DATA>","e2e"'],
      ['"status":"em_execucao","status_alterado_em"', '"estado":"em_execucao","estado_alterado_em"'],
      ['"status":"concluido","status_alterado_em"', '"estado":"concluido","estado_alterado_em"'],
    ] as const
  ).map(([de, para]) => ({
    arquivo: "cli/aula-e-demanda.txt",
    de,
    para,
    motivo: MOTIVO_ESTADO_COM_NOME_DA_ETAPA,
  })),
  ...(
    [
      [
        "textos/skills/registrar-necessidade/SKILL.md.txt",
        "`custos_realizados` (obrigatória) traz o uso desta sessão do Claude Code, somado do transcript por modelo.",
        "O Uso desta sessão do Claude Code, somado do transcript por modelo, é declarado com `fabriquinha demanda uso` (não é evidência nem trava o envio).",
      ],
      [
        "textos/skills/registrar-necessidade/SKILL.md.txt",
        "fabriquinha demanda evidencia I-<n> custos_realizados --dados custos.json",
        "fabriquinha demanda uso I-<n> --dados custos.json",
      ],
      [
        "textos/skills/registrar-necessidade/SKILL.md.txt",
        "Depois do envio, só `custos_realizados` aceita nova submissão;",
        "Depois do envio, só `fabriquinha demanda uso` aceita nova submissão (até a demanda terminar);",
      ],
      [
        "textos/pacote-pi/skills/demanda-externa/SKILL.md.txt",
        "(`criterios_aceite`, `desenho_solucao` e `custos_realizados` são obrigatórias)",
        "(`criterios_aceite` e `desenho_solucao` são obrigatórias)",
      ],
      [
        "textos/pacote-pi/skills/demanda-externa/SKILL.md.txt",
        "fabriquinha demanda evidencia I-30 custos_realizados --dados custos.json\n```\n",
        "```\n",
      ],
      [
        "textos/pacote-pi/skills/demanda-externa/SKILL.md.txt",
        "`custos.json` (sessões externas; omita `custo` se desconhecido, nunca ponha 0):",
        "Declarar o Uso das sessões externas (opcional; vale até a demanda terminar, repetir a mesma sessão não duplica):\n\n```\nfabriquinha demanda uso I-30 --dados custos.json\n```\n\n`custos.json` (omita `custo` se desconhecido, nunca ponha 0):",
      ],
      [
        "textos/pacote-pi/skills/demanda-externa/SKILL.md.txt",
        "Depois do envio só `custos_realizados` aceita nova submissão;",
        "Depois do envio só `fabriquinha demanda uso` aceita nova submissão;",
      ],
    ] as const
  ).map(([arquivo, de, para]) => ({
    arquivo,
    de,
    para,
    motivo:
      "I-278: custos_realizados deixa de ser Evidência e vira o Uso declarado, pelo comando `fabriquinha demanda uso`",
  })),
  {
    arquivo: "textos/skills/registrar-necessidade/SKILL.md.txt",
    de: "mostra a fase,",
    para: "mostra o estado,",
    motivo: MOTIVO_ESTADO_COM_NOME_DA_ETAPA,
  },
  ...(
    [
      ["textos/skills/registrar-necessidade/SKILL.md.txt", "Se o Auditor recusar,", "Se o Auditor reprovar,"],
      [
        "textos/pacote-pi/skills/artefato-desenho-solucao/SKILL.md.txt",
        "aprová-la ou recusá-la",
        "aprová-la ou reprová-la",
      ],
      [
        "textos/pacote-pi/skills/artefato-mensagem-pr/SKILL.md.txt",
        '"Recusar a aprovação da demanda',
        '"Reprovar a aprovação da demanda',
      ],
      [
        "textos/pacote-pi/skills/artefato-criterios-aceite/SKILL.md.txt",
        "clica em Recusar sem motivo",
        "clica em Reprovar sem motivo",
      ],
    ] as const
  ).map(([arquivo, de, para]) => ({ arquivo, de, para, motivo: MOTIVO_GATE_REPROVA })),
  {
    arquivo: "cli/aula-e-demanda.txt",
    de: "não toca nenhuma linha alterada pela issue",
    para: "não toca nenhuma linha alterada pela demanda",
    motivo: MOTIVO_NOME_NOVO,
  },
  {
    arquivo: "cli/aula-e-demanda.txt",
    de: "não é um arquivo criado ou alterado pela issue",
    para: "não é um arquivo criado ou alterado pela demanda",
    motivo: MOTIVO_NOME_NOVO,
  },
  {
    arquivo: "cli/aula-e-demanda.txt",
    de: "a issue não tem revisão concluída",
    para: "a demanda não tem revisão concluída",
    motivo: MOTIVO_NOME_NOVO,
  },
  {
    arquivo: "cli/aula.html.txt",
    de: "foram alteradas pela issue.",
    para: "foram alteradas pela demanda.",
    motivo: MOTIVO_NOME_NOVO,
  },
  {
    arquivo: "cli/pr-criado-fora.txt",
    de: "decide o destino da issue)",
    para: "decide o destino da demanda)",
    motivo: MOTIVO_NOME_NOVO,
  },
  {
    arquivo: "textos/src/execucao/avaliacao.md.txt",
    de: "não crie issue, demanda, ticket",
    para: "não crie demanda, ticket",
    motivo: `${MOTIVO_NOME_NOVO}; "issue" e "demanda" na mesma lista era redundância`,
  },
  {
    arquivo: "textos/pacote-pi/skills/artefato-impactos-arquitetura/SKILL.md.txt",
    de: "A página da issue mostra",
    para: "A página da demanda mostra",
    motivo: MOTIVO_NOME_NOVO,
  },
  {
    arquivo: "prompts/revisar_rodada.txt",
    de: "\n## Arquivos alterados\n",
    para: "\n## Revisões anteriores da rodada\n\nDecisões reprovadas dos tickets anteriores da rodada, pelo revisor ou pelo Auditor; confira cada uma e não reabra o que já foi decidido:\n\n(nenhuma)\n\n## Arquivos alterados\n",
    motivo: `${MOTIVO_REVISOES_ANTERIORES}; I-272: o vocabulário do gate é aprovar ou reprovar`,
  },
  ...["prompts/revisar_rodada.txt", "textos/src/execucao/etapas/revisar_rodada.md.txt"].map((arquivo) => ({
    arquivo,
    de: PASSOS_DO_REVISAR_RODADA_DA_BASE,
    para: PASSOS_DO_REVISAR_RODADA_COM_REVISOES_ANTERIORES,
    motivo: MOTIVO_REVISOES_ANTERIORES,
  })),
  ...["prompts/revisar_rodada.txt", "textos/src/execucao/etapas/revisar_rodada.md.txt"].map((arquivo) => ({
    arquivo,
    de: "o defeito material que a justifica.",
    para: "o defeito material que a justifica. Cada correção do `--correcoes` pede mudança em arquivos da worktree; corpo do PR, Sonar, deploy e cópia do banco não são correção.",
    motivo: MOTIVO_CORRECAO_MUDA_ARQUIVO,
  })),
  ...emPromptETexto("implementar").map((arquivo) => ({
    arquivo,
    de: PERMISSAO_DO_IMPLEMENTAR,
    para: `${PERMISSAO_DO_IMPLEMENTAR}${LINHA_DO_ESTRESSE}\n`,
    motivo: MOTIVO_ESTRESSE_SO_NA_CARGA,
  })),
  ...emPromptETexto("planejar").map((arquivo) => ({
    arquivo,
    de: PASSO_4_DO_PLANEJAR,
    para:
      PASSO_4_DO_PLANEJAR +
      "   Cada rodada a mais paga revisão, encerramento e gate do PR. Junte numa rodada só as rodadas em cadeia pura (a seguinte depende só da anterior, e nenhuma outra depende da anterior) quando a soma cabe num PR revisável (até 30 arquivos).\n" +
      "   Rodadas independentes ficam sem `depende` entre si, para rodarem em paralelo; `depende` só onde a ordem importa.\n",
    motivo: MOTIVO_RODADAS_EM_CADEIA,
  })),
  ...emPromptETexto("revisar_rodada").flatMap((arquivo) => [
    {
      arquivo,
      de: "3. Confira o código da worktree contra o plano e contra cada critério citado.",
      para: `3. Confira o código da worktree contra o plano e contra cada critério citado.${USE_AS_VERIFICACOES_JA_FEITAS}`,
      motivo: MOTIVO_VERIFICACOES_JA_FEITAS,
    },
    {
      arquivo,
      de: "não relance a espera turno após turno.",
      para: "não relance a espera turno após turno, nunca com `sleep` fixo nem esperando o check ou o e2e que a Fabriquinha já rodou.",
      motivo: MOTIVO_VERIFICACOES_JA_FEITAS,
    },
  ]),
  ...emPromptETexto("revisar_demanda").flatMap((arquivo) => [
    {
      arquivo,
      de: "2. Confira o código integrado da worktree contra cada critério da demanda.",
      para: `2. Confira o código integrado da worktree contra cada critério da demanda.${USE_AS_VERIFICACOES_JA_FEITAS}`,
      motivo: MOTIVO_VERIFICACOES_JA_FEITAS,
    },
    {
      arquivo,
      de: PASSO_3_DO_REVISAR_DEMANDA,
      para: `${PASSO_3_DO_REVISAR_DEMANDA}${LINHA_DO_ESTRESSE} Sem estresse, a evidência vai com \`aplicavel: false\` e a justificativa.\n`,
      motivo: MOTIVO_ESTRESSE_SO_NA_CARGA,
    },
    {
      arquivo,
      de: "\n**Entregas:**",
      para: "\nNão espere com `sleep` fixo: para esperar um processo, espere num único comando até a condição ou um tempo limite.\n\n**Entregas:**",
      motivo: MOTIVO_VERIFICACOES_JA_FEITAS,
    },
  ]),
  ...["revisar_rodada", "revisar_demanda"].map((etapa) => ({
    arquivo: `prompts/${etapa}.txt`,
    de: `## Modo de trabalhar: ${etapa.replace("_", " ")}\n`,
    para: `${SECAO_VERIFICACOES_JA_FEITAS}## Modo de trabalhar: ${etapa.replace("_", " ")}\n`,
    motivo: MOTIVO_VERIFICACOES_JA_FEITAS,
  })),
  ...(
    [
      [
        "textos/pacote-pi/skills/artefato-comportamento/SKILL.md.txt",
        "sem branch base, a tela",
        "sem `branch_base`, a tela",
      ],
      [
        "textos/pacote-pi/skills/artefato-criterios-aceite/SKILL.md.txt",
        "com branch base `main`",
        "com `branch_base` `main`",
      ],
      ...["prompts/resolver_conflito.txt", "textos/src/execucao/etapas/resolver_conflito.md.txt"].flatMap((arquivo) => [
        [arquivo, "incorporando a branch base configurada", "incorporando a `branch_base` configurada"],
        [arquivo, "2. Incorpore a branch base configurada", "2. Incorpore a `branch_base` configurada"],
      ]),
    ] as const
  ).map(([arquivo, de, para]) => ({ arquivo, de, para, motivo: MOTIVO_BRANCH_BASE_COM_NOME_DO_CAMPO })),
  ...(
    [
      [
        "artefato-testes-estresse",
        "A Fabriquinha calcula a aprovação: nenhum cenário `quebrou`. Não a informe.",
        "A Fabriquinha deriva o `veredito` dos dados: `atende` se nenhum cenário `quebrou`, `nao_atende` se algum quebrou. Não o informe.",
      ],
      [
        "artefato-analise-seguranca",
        "A Fabriquinha calcula a aprovação: nenhum achado `alta` ou `critica`. Não a informe.",
        "A Fabriquinha deriva o `veredito` dos dados: `atende` se nenhum achado é `alta` ou `critica`, `nao_atende` se algum é. Não o informe.",
      ],
      [
        "artefato-comprovacao-criterios",
        "um anexo pode provar mais de um critério.\n",
        "um anexo pode provar mais de um critério.\n\nA Fabriquinha deriva o `veredito` dos dados: `atende` se todos os critérios estão atendidos, `nao_atende` se algum não está. Não o informe.\n",
      ],
    ] as const
  ).map(([skill, de, para]) => ({
    arquivo: `textos/pacote-pi/skills/${skill}/SKILL.md.txt`,
    de,
    para,
    motivo: MOTIVO_VEREDITO_DO_PARECER,
  })),
  ...["prompts/revisar_rodada.txt", "textos/src/execucao/etapas/revisar_rodada.md.txt"].map((arquivo) => ({
    arquivo,
    de: '"caminhos": ["src/a.ts"]',
    para: '"arquivos_previstos": ["src/a.ts"]',
    motivo: MOTIVO_ARQUIVOS_PREVISTOS,
  })),
  ...(
    [
      ["cada um com seus critérios e caminhos.", "cada um com seus critérios e arquivos previstos."],
      ["com dependências e caminhos.\n", "com dependências e arquivos previstos.\n"],
      ["fica só para a revisão da demanda.\n", "fica só para a revisão da demanda.\n" + TRES_NIVEIS_NO_PLANEJAR],
    ] as const
  ).flatMap(([de, para]) =>
    emPromptETexto("planejar").map((arquivo) => ({ arquivo, de, para, motivo: MOTIVO_TRES_NIVEIS })),
  ),
  ...emPromptETexto("implementar").flatMap((arquivo) =>
    (
      [
        ["só nos caminhos do ticket", "só nos arquivos previstos do ticket"],
        ["fora dos seus caminhos,", "fora dos seus arquivos previstos,"],
        ["mexa em caminhos de outros tickets", "mexa em arquivos previstos de outros tickets"],
      ] as const
    ).map(([de, para]) => ({ arquivo, de, para, motivo: MOTIVO_TRES_NIVEIS })),
  ),
  ...(
    [
      ["com os `caminhos` (arquivos", "com os `arquivos_previstos` (arquivos"],
      ["fora dos `caminhos` dos tickets", "fora dos `arquivos_previstos` dos tickets"],
      [
        "o PR dela é o que o Auditor revisa.\n",
        "o PR dela é o que o Auditor revisa.\n8. Os `arquivos_previstos` existem nos três níveis: todo arquivo previsto do ticket está na sua rodada e todo arquivo previsto da rodada está na demanda (Ticket ⊆ Rodada ⊆ Demanda).\n   O plano que viola isso é recusado na submissão, com o arquivo e o nível no motivo.\n   Depois da aprovação não há replanejamento: mudança de rumo é correção do Plano, nunca um plano novo.\n",
      ],
      [
        "- `demanda_id` e `criterios`: a demanda (`I-206`) e todos os seus `CA-n`.\n- `rodadas`: `demanda_id`, `rodada_id`, `titulo`, `e2e`, `criterios`, `depende`.\n- `tickets`: `demanda_id`, `ticket_id`, `rodada_id`, `titulo`, `descricao`, `caminhos`, `depende`.",
        "- `demanda_id`, `criterios` e `arquivos_previstos`: a demanda (`I-206`), todos os seus `CA-n` e os arquivos que o trabalho todo toca.\n- `rodadas`: `demanda_id`, `rodada_id`, `titulo`, `e2e`, `criterios`, `arquivos_previstos`, `depende`.\n- `tickets`: `demanda_id`, `ticket_id`, `rodada_id`, `titulo`, `descricao`, `arquivos_previstos`, `depende`.",
      ],
      [
        '  "criterios": ["CA-1", "CA-2"],\n  "rodadas": [\n    { "demanda_id": "I-206", "rodada_id": 1, "titulo": "Cadastro", "e2e": false, "criterios": ["CA-1"], "depende": [] },',
        '  "criterios": ["CA-1", "CA-2"],\n  "arquivos_previstos": ["src/cadastro/**", "src/listagem/**"],\n  "rodadas": [\n    {\n      "demanda_id": "I-206",\n      "rodada_id": 1,\n      "titulo": "Cadastro",\n      "e2e": false,\n      "criterios": ["CA-1"],\n      "arquivos_previstos": ["src/cadastro/**"],\n      "depende": []\n    },',
      ],
      [
        '      "criterios": ["CA-2"],\n',
        '      "criterios": ["CA-2"],\n      "arquivos_previstos": ["src/listagem/**"],\n',
      ],
      ['"caminhos": ["src/cadastro/**"]', '"arquivos_previstos": ["src/cadastro/**"]'],
      ['"caminhos": ["src/listagem/**"]', '"arquivos_previstos": ["src/listagem/**"]'],
      [
        "- [ ] Os `caminhos` cobrem os `arquivosPrevistos` do desenho, e nada do `foraDeEscopo` entra no plano.\n",
        "- [ ] Os `arquivos_previstos` cobrem os `arquivosPrevistos` do desenho, e nada do `foraDeEscopo` entra no plano.\n- [ ] Todo arquivo previsto do ticket está na sua rodada e todo o da rodada está na demanda (Ticket ⊆ Rodada ⊆ Demanda).\n",
      ],
      ["- [ ] Os `caminhos` de rodadas", "- [ ] Os `arquivos_previstos` de rodadas"],
    ] as const
  ).map(([de, para]) => ({
    arquivo: "textos/pacote-pi/skills/artefato-plano/SKILL.md.txt",
    de,
    para,
    motivo: MOTIVO_TRES_NIVEIS,
  })),
];

function listarArquivos(pasta: string): string[] {
  return readdirSync(pasta, { recursive: true, withFileTypes: true })
    .filter((entrada) => entrada.isFile())
    .map((entrada) => join(entrada.parentPath, entrada.name).slice(pasta.length + 1))
    .sort();
}

function aplicarDiferencasIntencionais(arquivo: string, textoDaBase: string): string {
  return DIFERENCAS_INTENCIONAIS.filter((d) => d.arquivo === arquivo).reduce((texto, diferenca) => {
    assert.equal(
      texto.split(diferenca.de).length - 1,
      1,
      `${arquivo}: a diferença declarada "${diferenca.de}" não aparece uma vez na foto da base`,
    );
    return texto.replace(diferenca.de, diferenca.para);
  }, textoDaBase);
}

test("a foto atual de prompts e saídas do CLI é a da base anterior com só as diferenças intencionais", () => {
  execFileSync(
    process.execPath,
    ["--disable-warning=ExperimentalWarning", join(PASTA_DA_FOTO, "gerar.ts"), PASTA_DA_FOTO_ATUAL],
    { cwd: resolve(import.meta.dirname, ".."), stdio: "pipe" },
  );

  const arquivosDaBase = listarArquivos(PASTA_DA_FOTO_DA_BASE);
  const arquivoAtualDe = (arquivo: string) => ARQUIVOS_RENOMEADOS[arquivo] ?? arquivo;
  assert.deepEqual(
    listarArquivos(PASTA_DA_FOTO_ATUAL),
    arquivosDaBase.map(arquivoAtualDe).sort(),
    "o conjunto de fotos mudou",
  );
  for (const arquivo of arquivosDaBase) {
    const esperado = aplicarDiferencasIntencionais(arquivo, readFileSync(join(PASTA_DA_FOTO_DA_BASE, arquivo), "utf8"));
    const atual = readFileSync(join(PASTA_DA_FOTO_ATUAL, arquivoAtualDe(arquivo)), "utf8");
    assert.equal(atual, esperado, `${arquivo} difere da base`);
  }
});

test("toda diferença declarada aponta para uma foto que existe", () => {
  const arquivosDaBase = new Set(listarArquivos(PASTA_DA_FOTO_DA_BASE));
  for (const { arquivo } of DIFERENCAS_INTENCIONAIS) assert.ok(arquivosDaBase.has(arquivo), arquivo);
});
