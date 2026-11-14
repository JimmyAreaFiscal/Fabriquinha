// O que o Ambiente isolado do agente pode receber e onde ele pode escrever no `.git` do clone (CONCEITOS.md §7): quem roda
// código do agente no host tira daqui as credenciais do serviço, o Ambiente em container leva só as chaves do LLM, e o
// Repositório e o Ambiente combinam a pasta das entradas de worktree da Fabriquinha.

import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ErroDeRegra } from "../nucleo/erros.ts";

/** Variáveis com credencial de hospedagem ou do SonarQube (F4 §6.1, F5 §5.0). */
const CREDENCIAIS = new Set([
  "GH_TOKEN",
  "GITHUB_TOKEN",
  "GH_ENTERPRISE_TOKEN",
  "GITHUB_ENTERPRISE_TOKEN",
  "AZURE_DEVOPS_EXT_PAT",
  "SYSTEM_ACCESSTOKEN",
  "SONAR_TOKEN",
]);

export const ehCredencialDeHospedagemOuSonar = (nome: string): boolean => CREDENCIAIS.has(nome);

/**
 * `base` sem as credenciais, com `gh` e `az` lendo a configuração de `dirVazio`, onde não há login salvo. Para o que
 * roda código do agente: o pi e os coletores de testes e fitness.
 */
export function ambienteSemCredenciais(base: NodeJS.ProcessEnv, dirVazio: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [nome, valor] of Object.entries(base))
    if (valor !== undefined && !ehCredencialDeHospedagemOuSonar(nome)) env[nome] = valor;
  return { ...env, GH_CONFIG_DIR: dirVazio, AZURE_CONFIG_DIR: dirVazio };
}

const SUFIXO_DE_CHAVE_DE_PROVEDOR_DO_LLM = "_API_KEY";
// O pi aceita `AZURE_OPENAI_API_KEY`, mas o Ambiente que isola as variáveis do serviço nunca recebe variável de
// hospedagem ou do SonarQube.
export const CREDENCIAL_QUE_NUNCA_ENTRA_NO_AMBIENTE_ISOLADO = /^(GH_|AZURE_|SONAR_)/;

/** As chaves de provedor do LLM de `env`, sem credencial de hospedagem nem do SonarQube: o que o agente leva ao Ambiente isolado. */
export function chavesDeProvedorDoLlm(env: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).filter(
      (entrada): entrada is [string, string] =>
        entrada[1] !== undefined &&
        entrada[0].endsWith(SUFIXO_DE_CHAVE_DE_PROVEDOR_DO_LLM) &&
        !CREDENCIAL_QUE_NUNCA_ENTRA_NO_AMBIENTE_ISOLADO.test(entrada[0]),
    ),
  );
}

/**
 * A pasta de `<raiz_git>/.git` onde ficam as pastas administrativas das worktrees da Fabriquinha: o Ambiente que não
 * escreve em todo o `.git` do clone escreve nela (além de `objects`, `refs` e `logs`), e cada entrada de `worktrees` da
 * Fabriquinha é um link para cá. Uma worktree que o usuário criar fora da Fabriquinha fica fora do alcance dele.
 */
export const PASTA_DAS_ENTRADAS_DE_WORKTREE_DA_FABRIQUINHA = "fabriquinha-worktrees";

/** A raiz do pacote P1 `pi-fabriquinha`, versionado junto com a Fabriquinha (F4 §6.1): o Ambiente o monta para o harness. */
export const PACOTE = fileURLToPath(new URL("../../../pacote-pi", import.meta.url));

/** Onde o pi do Auditor guarda `auth.json` e `trust.json`: `$PI_CODING_AGENT_DIR` ou `~/.pi/agent`, como o próprio pi procura. */
export const dirDoPiDoAuditor = (): string => process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");

/** A instalação do harness no host, que o Ambiente monta em leitura: a raiz do pacote e o executável que vira o comando. */
export interface InstalacaoDoHarness {
  /** O nome do comando no container (`pi`). */
  comando: string;
  /** O arquivo que o comando executa, já sem links. */
  executavel: string;
  /** A pasta do pacote que contém o executável, montada em leitura no mesmo caminho. */
  raiz: string;
}

/** A pasta mais próxima do executável com `package.json`; sem nenhuma, a própria pasta dele (nunca a raiz do disco). */
function raizDoPacote(executavel: string): string {
  for (let pasta = dirname(executavel); dirname(pasta) !== pasta; pasta = dirname(pasta))
    if (existsSync(join(pasta, "package.json"))) return pasta;
  return dirname(executavel);
}

/**
 * Onde está o pi do host: `$FABRIQUINHA_PI` ou o `pi` do PATH, como o harness o chama, sem os links; a raiz é a pasta mais
 * próxima com `package.json`. O container monta essa raiz, e o `pi` dele aponta para o mesmo executável.
 */
export function instalacaoDoPi(env: NodeJS.ProcessEnv = process.env): InstalacaoDoHarness {
  const pedido = env.FABRIQUINHA_PI || "pi";
  const candidatos = isAbsolute(pedido) ? [pedido] : (env.PATH ?? "").split(delimiter).map((dir) => join(dir, pedido));
  const encontrado = candidatos.find((caminho) => existsSync(caminho));
  if (encontrado === undefined)
    throw new ErroDeRegra(`não achei o ${pedido} no host`, "instale o pi ou aponte FABRIQUINHA_PI para ele");
  const executavel = realpathSync(encontrado);
  return { comando: "pi", executavel, raiz: raizDoPacote(executavel) };
}
