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

const MOTIVO_NOME_NOVO = "o fluxo de issues foi desligado (cutover de 2026-10-28), e o texto passa a falar de demanda";
const MOTIVO_REVISOES_ANTERIORES =
  "I-294: a revisar_rodada recebe as revisões anteriores da rodada e confere primeiro os motivos, sem reabrir o decidido";
const PASSOS_DO_REVISAR_RODADA_DA_BASE =
  "2. Confira o código da worktree contra o plano e contra cada critério citado.\n3. Explique o resultado de cada fitness function, inclusive as que falharam.\n4. Comprove cada critério da rodada com o que você viu no código e nos testes.\n5. Depois";
const PASSOS_DO_REVISAR_RODADA_COM_REVISOES_ANTERIORES =
  '2. Confira primeiro, na seção "Revisões anteriores da rodada", se cada motivo anterior foi resolvido e se o diff dos tickets corretivos (`git log --grep` do endereço de cada um) regrediu algo. O que uma revisão anterior ou o Auditor já decidiu, inclusive nas respostas às perguntas listadas, não se reabre: não pergunte de novo nem reprove por isso. Isso não impede reprovar de novo um motivo anterior que continua sem correção: se o corretivo não o resolveu, reprove e registre o motivo.\n3. Confira o código da worktree contra o plano e contra cada critério citado.\n4. Explique o resultado de cada fitness function, inclusive as que falharam.\n5. Comprove cada critério da rodada com o que você viu no código e nos testes.\n6. Depois';
const MOTIVO_CORRECAO_MUDA_ARQUIVO =
  "I-295: cada correção do --correcoes pede mudança em arquivos da worktree, pois o implementar sem alteração é devolvido";
const DIFERENCAS_INTENCIONAIS: readonly DiferencaIntencional[] = [
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
    para: "\n## Revisões anteriores da rodada\n\nDecisões recusadas dos tickets anteriores da rodada, pelo revisor ou pelo Auditor; confira cada uma e não reabra o que já foi decidido:\n\n(nenhuma)\n\n## Arquivos alterados\n",
    motivo: MOTIVO_REVISOES_ANTERIORES,
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
  assert.deepEqual(listarArquivos(PASTA_DA_FOTO_ATUAL), arquivosDaBase, "o conjunto de fotos mudou");
  for (const arquivo of arquivosDaBase) {
    const esperado = aplicarDiferencasIntencionais(arquivo, readFileSync(join(PASTA_DA_FOTO_DA_BASE, arquivo), "utf8"));
    assert.equal(readFileSync(join(PASTA_DA_FOTO_ATUAL, arquivo), "utf8"), esperado, `${arquivo} difere da base`);
  }
});

test("toda diferença declarada aponta para uma foto que existe", () => {
  const arquivosDaBase = new Set(listarArquivos(PASTA_DA_FOTO_DA_BASE));
  for (const { arquivo } of DIFERENCAS_INTENCIONAIS) assert.ok(arquivosDaBase.has(arquivo), arquivo);
});
