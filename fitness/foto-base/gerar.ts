// Gera a "foto" dos prompts e das saídas do CLI que o texto da rodada I-263.R2 mexeu: `node gerar.ts <pasta-de-saída>`.
// Roda igual na base anterior e na rodada: só usa o CLI, o montador de prompt e o `publicarPRDe`, que existem nas duas.
// Veja o LEIAME.md.
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { Readable } from "node:stream";
import { executarFabriquinha } from "../../src/composicao/cli.ts";
import type { AgregadoDemanda, TicketDemanda } from "../../src/nucleo/agregado_demanda.ts";
import { EtapaTicket } from "../../src/nucleo/primitivos.ts";
import { criarTrabalho, iniciarProcesso } from "../../src/nucleo/trabalho_agentico.ts";
import { montarPromptDemanda } from "../../src/aplicacao/prompt_demanda.ts";
import { abrir } from "../../src/armazenamento/banco.ts";
import { gravarAgregadoPronto } from "../../apoio-testes/cenarios_de_demanda.ts";
import { comTrabalhosDoTicket } from "../../src/armazenamento/trabalho_agentico.ts";
import { publicarPRDe } from "../../src/infra/repositorio/pr.ts";

const raizDoCodigo = resolve(import.meta.dirname, "../..");
const pastaDeSaida = resolve(process.argv[2] ?? "");
if (!process.argv[2]) throw new Error("uso: node gerar.ts <pasta-de-saída>");
const temporaria = realpathSync(mkdtempSync(join(tmpdir(), "fabriquinha-foto-")));

// O que muda a cada execução (diretório temporário, commits, horas) não é diferença de texto.
function normalizar(texto: string): string {
  return texto
    .replaceAll(temporaria, "<TMP>")
    .replaceAll(/\b[0-9a-f]{64}\b/g, "<SHA256>")
    .replaceAll(/\b[0-9a-f]{40}\b/g, "<SHA>")
    .replaceAll(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/g, "<DATA>");
}

function gravarFoto(nome: string, texto: string): void {
  const destino = join(pastaDeSaida, `${nome}.txt`);
  mkdirSync(dirname(destino), { recursive: true });
  writeFileSync(destino, normalizar(texto));
}

// 1. Textos fixos: a parte fixa do prompt da avaliação, o modo de trabalhar de cada etapa e as skills.
function arquivosMarkdown(pasta: string): string[] {
  return readdirSync(join(raizDoCodigo, pasta), { recursive: true, encoding: "utf8" })
    .filter((arquivo) => arquivo.endsWith(".md"))
    .sort((a, b) => a.localeCompare(b))
    .map((arquivo) => join(pasta, arquivo));
}

for (const caminho of [
  "src/aplicacao/avaliacao.md",
  ...arquivosMarkdown("src/aplicacao/etapas"),
  ...arquivosMarkdown("skills"),
  ...arquivosMarkdown("pacote-pi/skills"),
]) {
  // A foto da base guarda os textos sob o caminho antigo (src/execucao/); só a leitura segue o caminho novo.
  gravarFoto(
    join("textos", caminho.replace("src/aplicacao/", "src/execucao/")),
    readFileSync(join(raizDoCodigo, caminho), "utf8"),
  );
}

// 2. O prompt montado de cada etapa, com o contexto fixo.
const agregadoDoPrompt = {
  demanda: { id: "I-206", titulo: "Busca", tipo: "problema", descricao: "A busca demora.", estado: "em_execucao" },
  tickets: [],
  decisoes: [],
  evidencias: [
    {
      demanda_id: "I-206",
      tipo: "criterios_aceite",
      em: "2026-10-11T12:00:00.000Z",
      dados: { criterios: [{ id: "CA-2", dado: "d", quando: "e", entao: "f" }] },
    },
  ],
  rodadas: [
    {
      demanda_id: "I-206",
      rodada_id: 2,
      titulo: "Índice",
      estado: "implementar",
      estado_alterado_em: "2026-10-11T12:00:00.000Z",
      e2e: false,
      branch: "x",
    },
  ],
  dependencias_rodada: [],
  criterios_citados: [{ demanda_id: "I-206", rodada_id: 2, criterio_id: "CA-2" }],
  dependencias_ticket: [{ demanda_id: "I-206", ticket_id: 3, depende_ticket_id: 1 }],
  caminhos_ticket: [{ demanda_id: "I-206", ticket_id: 3, caminho: "src/a.ts" }],
} as unknown as AgregadoDemanda;

for (const etapa of EtapaTicket.options.filter((e) => e !== "entender_e_desenhar")) {
  const ticket = {
    demanda_id: "I-206",
    ticket_id: 3,
    rodada_id: 2,
    titulo: "Fazer",
    descricao: "Detalhe.",
    etapa,
  } as TicketDemanda;
  const prompt = montarPromptDemanda({
    ag: agregadoDoPrompt,
    ticket,
    projeto: { nome: "loja", branch_base: "main" },
    worktree: "/w",
    saida: "/s",
    anexos: [],
  });
  gravarFoto(join("prompts", etapa), prompt);
}

// 3. O CLI do agente da demanda: a aula do código (HTML e recusas) e a leitura da demanda.
const em = "2026-01-01T00:00:00.000Z";

// O `git` do PATH do desenvolvedor, como em todos os testes do projeto.
function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd, encoding: "utf8" }).trim(); // NOSONAR
}

function montarCenarioDaAula(comRevisaoConcluida: boolean) {
  const raiz = mkdtempSync(join(temporaria, "raiz-"));
  const worktree = join(raiz, "worktrees", "loja", "I-206", "rodadas", "1");
  mkdirSync(worktree, { recursive: true });
  git(worktree, "init", "-q");
  writeFileSync(join(worktree, "a.ts"), "x\ny\nz\n");
  git(worktree, "add", ".");
  git(worktree, "commit", "-qm", "base");
  const base = git(worktree, "rev-parse", "HEAD");
  writeFileSync(join(worktree, "a.ts"), "x\nY\nZ\n");
  git(worktree, "commit", "-qam", "head");
  const arquivosAlterados = {
    base,
    head: git(worktree, "rev-parse", "HEAD"),
    arquivos: [
      { caminho: "a.ts", status: "M", adicionadas: 2, removidas: 2, previsto: "src/**" },
      { caminho: "b.ts", status: "A", adicionadas: 1, removidas: 0, previsto: null },
    ],
    previstosNaoTocados: [],
  };
  const banco = abrir(raiz);
  banco
    .prepare(
      `INSERT INTO projeto (nome, raiz_git, branch_base, hospedagem, chave_sonarqube)
       VALUES ('loja', '/repos/loja', 'main', 'github', 'k')`,
    )
    .run();
  const ticket = (ticket_id: number, etapa: string, extra: object = {}) => ({
    demanda_id: "I-206",
    ticket_id,
    etapa,
    estado: "em_execucao",
    estado_alterado_em: em,
    criado_por: { tipo: "fabriquinha" },
    ...extra,
  });
  gravarAgregadoPronto(banco, {
    demanda: {
      id: "I-206",
      projeto: "loja",
      titulo: "Busca <rápida>",
      tipo: "funcionalidade",
      descricao: "d",
      estado: "planejar",
      estado_alterado_em: em,
      criada_por: { tipo: "externo", ferramenta: "claude", sessao: "s1" },
      enviada: true,
      branch: "fabriquinha/I-206",
    },
    rodadas: [
      {
        demanda_id: "I-206",
        rodada_id: 1,
        titulo: "r1",
        estado: "revisar_rodada",
        estado_alterado_em: em,
        e2e: false,
        branch: "fabriquinha/I-206-1",
      },
    ],
    dependencias_rodada: [],
    criterios_citados: [{ demanda_id: "I-206", rodada_id: 1, criterio_id: "CA-1" }],
    tickets: [
      ticket(7, "encerrar_rodada", { rodada_id: 1 }),
      ...(comRevisaoConcluida ? [ticket(8, "revisar_rodada", { rodada_id: 1, estado: "concluido" })] : []),
    ],
    tentativas: [],
    dependencias_ticket: [],
    caminhos_ticket: [],
    arquivos_previstos_rodada: [],
    arquivos_previstos_demanda: [],
    versoes_plano: [],
    decisoes: [],
    evidencias: [
      {
        demanda_id: "I-206",
        tipo: "criterios_aceite",
        autor: { tipo: "externo", ferramenta: "claude", sessao: "s1" },
        em,
        dados: { criterios: [{ id: "CA-1" }, { id: "CA-2" }] },
      },
      ...(comRevisaoConcluida
        ? [
            {
              demanda_id: "I-206",
              ticket_id: 8,
              tipo: "arquivos_alterados",
              autor: { tipo: "fabriquinha" },
              em,
              dados: arquivosAlterados,
            },
          ]
        : []),
    ],
  } as unknown as AgregadoDemanda);
  comTrabalhosDoTicket(banco, { demanda_id: "I-206", ticket_id: 7 }, (e) => {
    const sessoes = criarTrabalho(e.sessoes, {
      id: "s-exec-7",
      demanda_id: "I-206",
      ticket_id: 7,
      modo: "autonomo",
      conversa_referencia: "s-exec-7",
    });
    return {
      ...e,
      sessoes,
      execucoes: iniciarProcesso(sessoes, e.execucoes, {
        id: "exec-7",
        trabalho_id: "s-exec-7",
        inicio: em,
        falha: false,
      }),
    };
  });
  return { raiz, banco, env: { FABRIQUINHA_ROOT: raiz, FABRIQUINHA_EXECUCAO: "exec-7" } };
}

async function rodarCli(env: NodeJS.ProcessEnv, args: string[]): Promise<string> {
  let saida = "";
  let erro = "";
  const codigo = await executarFabriquinha(args, {
    env,
    stdin: Readable.from([""]),
    stdout: { write: (t: string) => (saida += t) },
    stderr: { write: (t: string) => (erro += t) },
    parada: () => Promise.resolve(),
  });
  return `$ fabriquinha ${args.join(" ").replace(/--dados \S+/, "--dados <dados.json>")}\ncódigo: ${String(codigo)}\n--- stdout\n${saida}--- stderr\n${erro}`;
}

function aulaComTrecho(arquivo: string, inicio: number, fim: number, raiz: string): string[] {
  const dados = join(raiz, `aula-${arquivo}-${String(inicio)}-${String(fim)}.json`);
  const trecho = { arquivo, inicio, fim, oQueFaz: "f", porQue: "p", decisaoDoDesenho: "d" };
  writeFileSync(dados, JSON.stringify({ trechos: [trecho] }));
  return ["evidencia", "add", "I-206.T7", "aula_codigo", "--dados", dados];
}

const completo = montarCenarioDaAula(true);
const semRevisao = montarCenarioDaAula(false);
const saidasDoCli = [
  await rodarCli(completo.env, ["evidencia", "schema", "aula_codigo"]),
  await rodarCli(completo.env, aulaComTrecho("a.ts", 1, 1, completo.raiz)),
  await rodarCli(completo.env, aulaComTrecho("c.ts", 1, 1, completo.raiz)),
  await rodarCli(semRevisao.env, aulaComTrecho("a.ts", 2, 3, semRevisao.raiz)),
  await rodarCli(completo.env, aulaComTrecho("a.ts", 2, 3, completo.raiz)),
  await rodarCli(completo.env, ["demanda", "ver", "I-206"]),
];
gravarFoto("cli/aula-e-demanda", saidasDoCli.join("\n"));

const [anexoDaAula] = completo.banco.prepare("SELECT sha256 FROM arquivo_evidencia").all() as { sha256: string }[];
if (!anexoDaAula) throw new Error("a aula não gravou anexo");
const { sha256 } = anexoDaAula;
gravarFoto("cli/aula.html", readFileSync(join(completo.raiz, "arquivos", sha256.slice(0, 2), sha256), "utf8"));

// 4. Os erros do PR criado fora da Fabriquinha, com um `gh` falso que lista um PR da branch.
const pastaDoGh = join(temporaria, "bin");
mkdirSync(pastaDoGh);
const urlDoPR = "https://github.com/org/loja/pull/1";
const listaDoGh = (state: string) =>
  JSON.stringify([{ number: 1, url: urlDoPR, state, body: "", baseRefName: "main", isCrossRepository: false }]);
function instalarGh(estado: string): void {
  const gh = join(pastaDoGh, "gh");
  writeFileSync(gh, `#!/bin/sh\necho '${listaDoGh(estado)}'\n`);
  chmodSync(gh, 0o755);
}

// O `gh` falso precisa vir antes do verdadeiro; a pasta é temporária, criada e apagada por este script.
process.env.PATH = `${pastaDoGh}:${process.env.PATH ?? ""}`; // NOSONAR
const errosDoPR: string[] = [];
for (const estado of ["MERGED", "OPEN"]) {
  instalarGh(estado);
  try {
    await publicarPRDe(
      join(temporaria, "raiz-pr"),
      { nome: "loja", raiz_git: temporaria, hospedagem: "github" },
      { branch: "fabriquinha/I-1", base: "main", publicarBase: false },
      { titulo: "feat: A [I-1]", corpo: "m\ncorpo", conhecidos: [], marca: "<!-- fabriquinha I-1/T-6 -->" },
      () => undefined,
    );
    errosDoPR.push(`${estado}: publicou`);
  } catch (error) {
    const { message, name } = error as Error;
    errosDoPR.push(`${estado}: ${name}: ${message}`);
  }
}
gravarFoto("cli/pr-criado-fora", errosDoPR.join("\n") + "\n");

rmSync(temporaria, { recursive: true, force: true });
