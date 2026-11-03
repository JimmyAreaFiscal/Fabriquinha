// Grupo do estresse das etapas do agendador: uma ação por `src/execucao/etapas/*.md`. Cada execução monta o próprio
// cenário (banco, projeto e repositórios git reais, como integracao/apoio.ts) numa pasta da raiz do ambiente e leva a
// demanda à fase da etapa fora do tempo medido, com o pi falso e o `gh` falso de integracao/falsos.ts. O tempo vai do
// despacho do ticket até ele assentar concluído; `sessao_em_aberto` vai da abertura da sessão à primeira resposta do pi.
// Ao fim de cada execução a pasta some, depois de conferir que não sobrou worktree, branch nem pi falso.
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { setTimeout as dormir } from "node:timers/promises";
import { AUDITOR } from "../../src/dominio/agregado.ts";
import { registrarCorrecoesSessao } from "../../src/dominio/transicoes_rodada.ts";
import {
  type AutorDemanda,
  type EntradaEvidenciaDemanda,
  submeterEvidenciaDemanda,
} from "../../src/dominio/evidencia_demanda.ts";
import { marcaDoPRFinal } from "../../src/evidencias/encerramento_demanda.ts";
import type { Verificacao } from "../../src/evidencias/verificacoes.ts";
import { aprovarPRRodada } from "../../src/execucao/aprovacao_pr_rodada.ts";
import { type DepsDespacho, despacharDemandas } from "../../src/execucao/despacho_demanda.ts";
import { iniciarExecucaoDemanda, interromperExecucaoDemanda } from "../../src/execucao/execucao_demanda.ts";
import { fecharTicketDemanda } from "../../src/execucao/fechamento_ticket.ts";
import * as gestao from "../../src/execucao/gestao_demandas.ts";
import { aprovarPlanejamentoDemanda, submeterPlanejamento } from "../../src/execucao/planejamento.ts";
import { decidirRevisaoIntegral } from "../../src/execucao/revisao_demanda.ts";
import { decidirRevisaoRodada } from "../../src/execucao/revisao_rodada.ts";
import { reprovarPRRodada, concluirSessaoAjustes } from "../../src/execucao/sessao_ajustes.ts";
import { situacao } from "../../src/execucao/gerente.ts";
import { abrir } from "../../src/persistencia/banco.ts";
import { gravarConfiguracaoProjeto } from "../../src/persistencia/configuracao_projeto.ts";
import { carregarDemanda, comDemanda } from "../../src/persistencia/demandas.ts";
import { registrarProjeto } from "../../src/persistencia/projetos.ts";
import { configuracao } from "../../src/persistencia/servico.ts";
import { carregarSessoesDoTicket } from "../../src/persistencia/sessoes.ts";
import { exigirGit } from "../../src/repositorio/worktree.ts";
import { ghFalso, piFalso } from "../../integracao/falsos.ts";
import type { Ambiente } from "../ambiente.ts";

/** Execuções por etapa e quantas ao mesmo tempo: git e worktree são caros, então menos que as 200/20 do HTTP. */
export const EXECUCOES = 20;
export const SIMULTANEAS = 5;

/** Uma etapa medida: `chamar` faz uma execução e devolve o tempo em ms, ou lança quando o ticket não assenta concluído. */
export interface AcaoEtapa {
  /** O nome do arquivo em `src/execucao/etapas/`, sem `.md`. */
  etapa: string;
  /** Orçamento de p95 em ms: 3× o maior p95 de duas medições de 20 execuções com 5 simultâneas nesta máquina (Linux, Node 22, SQLite e git locais), para não virar teste instável. */
  orcamento: number;
  chamar(): Promise<number>;
}

const PASTA_ETAPAS = join(import.meta.dirname, "../../src/execucao/etapas");
const AUTOR: AutorDemanda = { ferramenta: "claude", sessao: "S1" };
const agora = () => new Date().toISOString();

/** Um cenário: banco e repositórios próprios, para as execuções simultâneas não dividirem estado. */
interface Cenario {
  dir: string;
  raiz: string;
  banco: ReturnType<typeof abrir>;
  projeto: string;
  repo: string;
  config: ReturnType<typeof configuracao>;
  gh: ReturnType<typeof ghFalso>;
}

/** O que uma etapa prepara (fora do tempo) e executa (medido); `concluido` diz se o ticket assentou concluído. */
interface Execucao {
  executar(): Promise<void>;
  concluido(): boolean;
  /** Depois do tempo medido: o que a etapa deixou de pé (a sessão de ajustes). */
  encerrar?(): Promise<void>;
}

/** O ticket atual (o de maior id) da etapa; cada cenário tem uma só rodada. */
const ticket = (c: Cenario, id: string, etapa: string) => {
  const t = carregarDemanda(c.banco, id)
    .tickets.filter((x) => x.etapa === etapa)
    .sort((a, b) => b.ticket_id - a.ticket_id)[0];
  if (!t) throw new Error(`sem ticket ${etapa}`);
  return t;
};
const concluido = (c: Cenario, id: string, etapa: string) => ticket(c, id, etapa).status === "concluido";

async function esperar(condicao: () => boolean, descricao: string, limiteMs = 30_000): Promise<void> {
  const fim = Date.now() + limiteMs;
  while (!condicao()) {
    if (Date.now() > fim) throw new Error(`tempo esgotado esperando: ${descricao}`);
    await dormir(20);
  }
}

/** Quantos prompts o pi falso recebeu em worktrees deste cenário (o registro é lido linha a linha: outros pi escrevem nele). */
const chamadas = (c: Cenario): number =>
  readFileSync(String(process.env.FALSO_PI_CHAMADAS), "utf8")
    .split("\n")
    .filter((l) => l.includes(`"cwd":"${c.dir}`)).length;

// O "agente" do pi falso, comum às etapas: espera o portão do cenário (o `executar` o abre) e, com `escreve`, mexe na worktree.
const AGENTE = `import { appendFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
export default async () => {
  let dir = process.cwd();
  while (!existsSync(join(dir, ".cenario"))) dir = dirname(dir);
  while (!existsSync(join(dir, "portao"))) await new Promise((r) => setTimeout(r, 20));
  if (existsSync(join(dir, "escreve"))) appendFileSync("feature.txt", "linha\\n");
};
`;
// Cada `gh` acha o estado do cenário em que roda, subindo do diretório de trabalho até o `hospedagem.json`.
const GH = `#!/bin/sh
d=$PWD
while [ ! -f "$d/hospedagem.json" ]; do d=$(dirname "$d"); [ "$d" = / ] && exit 1; done
FALSO_HOSPEDAGEM="$d/hospedagem.json" exec "$d/bin/gh" "$@"
`;

/** Prepara o processo: git, pi e `gh` isolados da máquina (como integracao/apoio.ts) e o pi falso com o agente comum. */
function prepararProcesso(amb: Ambiente): string {
  const raiz = join(amb.raiz, "etapas");
  mkdirSync(join(raiz, "pi-agent"), { recursive: true });
  writeFileSync(join(raiz, "gitconfig"), "[user]\n\tname = Estresse\n\temail = estresse@exemplo.com\n");
  process.env.GIT_CONFIG_GLOBAL = join(raiz, "gitconfig");
  process.env.GIT_CONFIG_NOSYSTEM = "1";
  process.env.PI_CODING_AGENT_DIR = join(raiz, "pi-agent");
  process.env.GH_TOKEN = "token-do-servico";
  mkdirSync(join(raiz, "gh"));
  writeFileSync(join(raiz, "gh", "gh"), GH);
  chmodSync(join(raiz, "gh", "gh"), 0o755);
  process.env.PATH = `${join(raiz, "gh")}:${process.env.PATH ?? ""}`;
  writeFileSync(join(raiz, "agente.mjs"), AGENTE);
  piFalso(raiz).roteirizar([{ modo: "ok", agente: join(raiz, "agente.mjs") }]);
  return raiz;
}

async function criarCenario(pasta: string): Promise<Cenario> {
  const dir = mkdtempSync(join(pasta, "c-"));
  const raiz = join(dir, "raiz");
  mkdirSync(raiz);
  writeFileSync(join(dir, ".cenario"), "");
  const banco = abrir(raiz);
  const bare = join(dir, "loja.git");
  const repo = join(dir, "loja");
  mkdirSync(repo);
  await exigirGit(dir, "init", "-q", "--bare", bare);
  await exigirGit(repo, "init", "-q", "-b", "main");
  writeFileSync(join(repo, "base.txt"), "base\n");
  await exigirGit(repo, "add", "base.txt");
  await exigirGit(repo, "commit", "-q", "-m", "base");
  await exigirGit(repo, "remote", "add", "origin", bare);
  await exigirGit(repo, "push", "-q", "origin", "main");
  registrarProjeto(banco, {
    nome: "loja",
    repo,
    branchBase: "main",
    hospedagem: "github",
    preparacao: [],
    sonar: { projectKey: "loja" },
  });
  gravarConfiguracaoProjeto(banco, {
    nome: "loja",
    branch_base: "main",
    chave_sonarqube: "loja",
    raiz_git: repo,
    hospedagem: "github",
    etapas: [],
    fitness: [{ nome: "f", comando: "true", descricao: "d" }],
    linguagens: [{ caminho: ".", linguagem: "ts", comando_teste: "true" }],
  });
  // ghFalso põe o `bin` do cenário na frente do PATH; quem escolhe o estado é o `gh` comum, então o PATH volta como estava.
  const path = process.env.PATH;
  const gh = ghFalso(dir);
  process.env.PATH = path;
  return { dir, raiz, banco, projeto: "loja", repo, config: configuracao(banco), gh };
}

const portao = (c: Cenario, aberto: boolean) => {
  if (aberto) writeFileSync(join(c.dir, "portao"), "");
  else rmSync(join(c.dir, "portao"), { force: true });
};
const escreve = (c: Cenario, ligado: boolean) => {
  if (ligado) writeFileSync(join(c.dir, "escreve"), "");
  else rmSync(join(c.dir, "escreve"), { force: true });
};

// Evidências de uma IA externa que registra a demanda, como em integracao/apoio.ts.
const criterios = { criterios: [{ id: "CA-1", dado: "um dado", quando: "quando", entao: "então" }] };
const desenho = { resumo: "r", arquivosPrevistos: [{ caminho: "src/a.ts", acao: "criar", motivo: "porque" }] };
const html = [{ nome: "d.html", mime: "text/html; charset=utf-8", conteudo: Buffer.from("<p>x</p>") }];
const custos = {
  sessoes: [
    {
      ferramenta: "claude",
      sessao: "ext",
      linhas: [
        {
          provedor: "a",
          modelo: "m",
          tokens_entrada: 1,
          tokens_saida: 1,
          tokens_cache_leitura: 0,
          tokens_cache_escrita: 0,
        },
      ],
    },
  ],
};

/** Demanda registrada, enviada e aprovada pelo Auditor: em `planejamento`, com o `planejar` (ticket 2) aberto. */
function demandaAprovada(c: Cenario): string {
  const ctx = { agora: agora() };
  const id = gestao.registrar(
    c.banco,
    { projeto: c.projeto, titulo: "Titulo", tipo: "funcionalidade", descricao: "Desc" },
    AUTOR,
    ctx,
  ).demanda.id;
  const submeter = (tipo: string, dados: unknown, arquivos?: gestao.EntradaEvidencia["arquivos"]) =>
    gestao.submeterEvidencia(c.banco, id, { tipo, dados, arquivos } as gestao.EntradaEvidencia, AUTOR, ctx);
  submeter("criterios_aceite", criterios);
  submeter("desenho_solucao", desenho, html);
  submeter("custos_realizados", custos);
  gestao.enviar(c.banco, id, AUTOR, ctx);
  gestao.decidir(c.banco, id, { aprovado: true }, AUDITOR, ctx);
  return id;
}

/** O planejamento em curso (`fim`) até a aprovação do plano de uma rodada com um ticket: a demanda vai a `execucao`. */
async function aprovarPlano(c: Cenario, id: string, fim: Promise<unknown>, antes: number): Promise<void> {
  await esperar(() => chamadas(c) > antes, "o pi receber o prompt do planejamento");
  interromperExecucaoDemanda(c.banco, { demanda_id: id, ticket_id: 2 });
  await fim;
  submeterPlanejamento(
    c.banco,
    id,
    {
      demanda_id: id,
      criterios: ["CA-1"],
      rodadas: [{ demanda_id: id, rodada_id: 1, titulo: "Rodada 1", e2e: false, criterios: ["CA-1"], depende: [] }],
      tickets: [{ demanda_id: id, ticket_id: 1, rodada_id: 1, titulo: "Ticket 1.1", descricao: "d" }],
    },
    { tipo: "agente", execucao: 1, ticket: 2 },
  );
  await aprovarPlanejamentoDemanda(c.banco, id, {});
}

const verificacoes = (): Verificacao[] =>
  (["execucao_testes", "matriz_fitness", "relatorio_sonar"] as const).map((tipo) => ({
    tipo,
    aprovada: true,
    falhas: [],
    dados: {},
    logs: [{ nome: `${tipo}.log`, texto: `log de ${tipo}` }],
  }));

/** Despacho que roda o pi de verdade e fecha o ticket com as verificações aprovadas (sem testes nem Sonar reais). */
const deps: DepsDespacho = {
  iniciarExecucao: (banco, t, opcoes) =>
    iniciarExecucaoDemanda(banco, t, {
      ...opcoes,
      fechar: (b, ref, r) =>
        fecharTicketDemanda(b, ref, r, { coletarVerificacoes: () => Promise.resolve(verificacoes()) }),
    }),
  verificacao: { intervaloMs: 1, carenciaMs: 0, limiteMs: 5000 },
};

/** Um ciclo do agendador e a espera das etapas que ele disparou. */
async function ciclo(c: Cenario): Promise<void> {
  await Promise.all(despacharDemandas(c.banco, c.config, deps));
}

/** Um ciclo com o pi parado no portão: `agir` faz o papel do agente enquanto a execução segue aberta. */
async function cicloComAgente(c: Cenario, agir: () => void): Promise<void> {
  portao(c, false);
  const antes = chamadas(c);
  const fins = despacharDemandas(c.banco, c.config, deps);
  if (fins.length === 0) throw new Error("o ciclo não despachou nada");
  await esperar(() => chamadas(c) >= antes + fins.length, "o pi receber o prompt");
  agir();
  portao(c, true);
  await Promise.all(fins);
}

/** As evidências que cabem ao agente do ticket, submetidas como a ferramenta autora da demanda as enviaria. */
function comoAgente(c: Cenario, id: string, ticket_id: number, evidencias: [string, object][]): void {
  comDemanda(c.banco, id, (ag) =>
    evidencias.reduce(
      (a, [tipo, dados]) =>
        submeterEvidenciaDemanda(
          a,
          { tipo, dados, ticket_id } as EntradaEvidenciaDemanda,
          { ferramenta: a.demanda.origem_ferramenta, sessao: a.demanda.origem_sessao },
          agora(),
        ),
      ag,
    ),
  );
}

const comprovacao = ["comprovacao_criterios", { criterios: [{ id: "CA-1", atendido: true, arquivos: [] }] }] as [
  string,
  object,
];

const revisarRodada = (c: Cenario, id: string) =>
  cicloComAgente(c, () => {
    const { ticket_id } = ticket(c, id, "revisar_rodada");
    comoAgente(c, id, ticket_id, [["explicacao_fitness", { explicacoes: [] }], comprovacao]);
    decidirRevisaoRodada(
      c.banco,
      { aprovado: true, demanda_id: id, rodada_id: 1, ticket_id },
      { tipo: "agente", execucao: 1, ticket: ticket_id },
    );
  });

const encerrarRodada = (c: Cenario, id: string) =>
  cicloComAgente(c, () => {
    const mensagem = {
      titulo: "Encerrar a rodada",
      oQueMudou: "Conduz o encerramento.",
      decisoesNaoObvias: [],
      naoFeito: [],
      comoRevisar: ["Leia o diff."],
      naoVerificado: [],
    };
    comoAgente(c, id, ticket(c, id, "encerrar_rodada").ticket_id, [
      ["mensagem_pr", mensagem],
      ["aula_codigo", { resumo: "aula" }],
    ]);
  });

const aprovarRodada = (c: Cenario, id: string) =>
  aprovarPRRodada(c.banco, { demanda_id: id, rodada_id: 1 }, 4, AUDITOR);

const revisarDemanda = (c: Cenario, id: string) =>
  cicloComAgente(c, () => {
    const { ticket_id } = ticket(c, id, "revisar_demanda");
    comoAgente(c, id, ticket_id, [
      comprovacao,
      ["testes_estresse", { aplicavel: false, cenarios: [], justificativa: "sem carga" }],
      ["analise_seguranca", { aplicavel: false, ameacas: [], achados: [], justificativa: "sem superfície" }],
    ]);
    decidirRevisaoIntegral(
      c.banco,
      { demanda_id: id, ticket_id, aprovado: true },
      { tipo: "agente", execucao: 1, ticket: ticket_id },
    );
  });

// Os passos de preparação, cada um sobre o anterior; o pi do cenário só espera o portão quando o passo o fecha.

/** Demanda em `execucao`, com o `implementar` da rodada 1 aberto. */
async function emExecucao(c: Cenario): Promise<string> {
  const id = demandaAprovada(c);
  portao(c, true);
  const { fim } = despacharPlanejamento(c, id);
  await aprovarPlano(c, id, fim, 0);
  return id;
}
// O despacho do planejamento sem o agendador, que mediria o ciclo inteiro.
const despacharPlanejamento = (c: Cenario, id: string) => {
  const [fim] = despacharDemandas(c.banco, c.config, deps);
  if (!fim) throw new Error(`o planejamento de ${id} não foi despachado`);
  return { fim };
};

/** Implementada pelo agendador: a rodada em `revisao`. */
async function emRevisao(c: Cenario): Promise<string> {
  const id = await emExecucao(c);
  escreve(c, true);
  await ciclo(c);
  escreve(c, false);
  return id;
}

/** Revisada e aprovada: a rodada em `encerramento`. */
async function emEncerramento(c: Cenario): Promise<string> {
  const id = await emRevisao(c);
  await revisarRodada(c, id);
  return id;
}

/** Encerrada: o PR da rodada aberto, esperando o Auditor. */
async function comPR(c: Cenario): Promise<string> {
  const id = await emEncerramento(c);
  await encerrarRodada(c, id);
  return id;
}

/** Rodada integrada: todas concluídas, a demanda pronta para a revisão integral. */
async function rodadaConcluida(c: Cenario): Promise<string> {
  const id = await comPR(c);
  await aprovarRodada(c, id);
  return id;
}

/** Revisão integral aprovada: a demanda em `encerramento`, com o `encerrar_demanda` aberto. */
async function emEncerramentoDemanda(c: Cenario): Promise<string> {
  const id = await rodadaConcluida(c);
  await revisarDemanda(c, id);
  return id;
}

type Preparar = (c: Cenario) => Promise<Execucao>;

const ticketDaEtapa =
  (
    etapa: string,
    preparar: (c: Cenario) => Promise<string>,
    executar: (c: Cenario, id: string) => Promise<void>,
  ): Preparar =>
  async (c) => {
    const id = await preparar(c);
    return { executar: () => executar(c, id), concluido: () => concluido(c, id, etapa) };
  };

const ETAPAS: Record<string, Preparar> = {
  planejar: (c) => {
    const id = demandaAprovada(c);
    portao(c, true);
    return Promise.resolve({
      executar: async () => {
        const { fim } = despacharPlanejamento(c, id);
        await aprovarPlano(c, id, fim, 0);
      },
      concluido: () => concluido(c, id, "planejar"),
    });
  },
  implementar: ticketDaEtapa("implementar", emExecucao, async (c) => {
    escreve(c, true);
    await ciclo(c);
  }),
  revisar_rodada: ticketDaEtapa("revisar_rodada", emRevisao, revisarRodada),
  encerrar_rodada: ticketDaEtapa("encerrar_rodada", emEncerramento, async (c, id) => {
    await encerrarRodada(c, id);
    await aprovarRodada(c, id);
  }),
  resolver_conflito: ticketDaEtapa(
    "resolver_conflito",
    async (c) => {
      const id = await emEncerramentoDemanda(c);
      // Um PR final em conflito: o primeiro ciclo abre o `resolver_conflito`, que o ciclo medido executa.
      c.gh.abrir({
        head: carregarDemanda(c.banco, id).demanda.branch,
        base: "main",
        titulo: "velho",
        corpo: marcaDoPRFinal(id),
        estado: "aberto",
        conflito: true,
      });
      await ciclo(c);
      return id;
    },
    async (c) => {
      escreve(c, true);
      portao(c, true);
      await ciclo(c);
    },
  ),
  revisar_demanda: ticketDaEtapa("revisar_demanda", rodadaConcluida, revisarDemanda),
  encerrar_demanda: ticketDaEtapa("encerrar_demanda", emEncerramentoDemanda, ciclo),
  sessao_em_aberto: async (c) => {
    const id = await comPR(c);
    portao(c, true);
    const ref = { demanda_id: id, rodada_id: 1 };
    let respondeu = false;
    return {
      executar: async () => {
        const antes = chamadas(c);
        await reprovarPRRodada(c.banco, ref, "o PR mistura duas mudanças", AUDITOR, { limiteMin: c.config.timeoutMin });
        await esperar(() => {
          const { ticket_id } = ticket(c, id, "sessao_em_aberto");
          const sessao = carregarSessoesDoTicket(c.banco, { demanda_id: id, ticket_id }).sessoes[0];
          return chamadas(c) > antes && sessao !== undefined && situacao(sessao.id)?.ocupado === false;
        }, "a primeira resposta do pi");
        respondeu = true;
      },
      concluido: () => respondeu,
      // A conversa só registra correções: conclui-la encerra o pi ocioso.
      encerrar: async () => {
        const { ticket_id } = ticket(c, id, "sessao_em_aberto");
        const correcao = {
          demanda_id: id,
          ticket_id: 1,
          rodada_id: 1,
          titulo: "Separar as mudanças",
          descricao: "d",
          caminhos: [],
        };
        comDemanda(c.banco, id, (ag) =>
          registrarCorrecoesSessao(ag, { ...ref, ticket_id, correcoes: [correcao] }, AUDITOR, { agora: agora() }),
        );
        await concluirSessaoAjustes(c.banco, ref, AUDITOR);
      },
    };
  },
};

/** Os pids cujo diretório de trabalho está dentro de `dir`: o pi falso que ficou de pé. */
function processosEm(dir: string): number[] {
  return readdirSync("/proc")
    .filter((p) => /^\d+$/.test(p))
    .filter((p) => {
      try {
        return readlinkSync(`/proc/${p}/cwd`).startsWith(dir);
      } catch {
        return false; // saiu entre a listagem e a leitura
      }
    })
    .map(Number);
}

/** Desfaz o cenário e devolve o que sobrou: pi falso vivo, worktree e branch além da base. Vazio quando limpo. */
async function limpar(c: Cenario): Promise<string[]> {
  const sobras: string[] = [];
  const fim = Date.now() + 3000;
  while (processosEm(c.dir).length > 0 && Date.now() < fim) await dormir(20);
  for (const pid of processosEm(c.dir)) {
    sobras.push(`processo ${String(pid)}`);
    process.kill(pid, "SIGKILL");
  }
  c.banco.close();
  const lista = async (...args: string[]) => (await exigirGit(c.repo, ...args)).split("\n").filter(Boolean);
  try {
    for (const linha of await lista("worktree", "list", "--porcelain")) {
      const caminho = linha.startsWith("worktree ") ? linha.slice(9) : undefined;
      if (caminho !== undefined && caminho !== c.repo)
        await exigirGit(c.repo, "worktree", "remove", "--force", caminho);
    }
    await exigirGit(c.repo, "worktree", "prune");
    for (const branch of await lista("for-each-ref", "--format=%(refname:short)", "refs/heads")) {
      if (branch !== "main") await exigirGit(c.repo, "branch", "-D", branch);
    }
    sobras.push(
      ...(await lista("worktree", "list", "--porcelain"))
        .filter((l) => l.startsWith("worktree ") && l.slice(9) !== c.repo)
        .map((l) => `worktree ${l.slice(9)}`),
      ...(await lista("for-each-ref", "--format=%(refname:short)", "refs/heads"))
        .filter((b) => b !== "main")
        .map((b) => `branch ${b}`),
    );
  } catch (erro) {
    sobras.push(`git: ${(erro as Error).message}`);
  }
  rmSync(c.dir, { recursive: true, force: true });
  return sobras;
}

/** Uma execução da etapa: prepara, mede, confere o ticket e a limpeza; erro em qualquer passo conta como erro da etapa. */
async function executarEtapa(pasta: string, etapa: string): Promise<number> {
  const preparar = ETAPAS[etapa];
  if (!preparar) throw new Error(`etapa sem preparação: ${etapa}`);
  const c = await criarCenario(pasta);
  let tempo = 0;
  let erro: Error | undefined;
  try {
    const e = await preparar(c);
    const inicio = performance.now();
    await e.executar();
    tempo = performance.now() - inicio;
    if (!e.concluido()) throw new Error("o ticket não assentou concluído");
    await e.encerrar?.();
  } catch (e) {
    erro = e as Error;
  }
  const sobras = await limpar(c);
  if (erro) throw erro;
  if (sobras.length > 0) throw new Error(`sobrou: ${sobras.join(", ")}`);
  return tempo;
}

/** Prepara o ambiente e devolve uma ação por etapa conhecida. O orçamento de cada uma fica ao lado dela. */
export function acoesEtapas(amb: Ambiente): AcaoEtapa[] {
  const pasta = prepararProcesso(amb);
  const acao = (etapa: string, orcamento: number): AcaoEtapa => ({
    etapa,
    orcamento,
    chamar: () => executarEtapa(pasta, etapa),
  });
  return [
    acao("planejar", 6930),
    acao("implementar", 6550),
    acao("revisar_rodada", 7460),
    acao("encerrar_rodada", 12560),
    acao("resolver_conflito", 4910),
    acao("revisar_demanda", 3160),
    acao("encerrar_demanda", 7710),
    acao("sessao_em_aberto", 7440),
  ];
}

/** As etapas de `src/execucao/etapas/` que nenhuma ação mede; vazio quando a cobertura está completa. */
export function semMedicao(acoes: readonly AcaoEtapa[]): string[] {
  const medidas = new Set(acoes.map((a) => a.etapa));
  return readdirSync(PASTA_ETAPAS)
    .filter((f) => f.endsWith(".md"))
    .map((f) => f.slice(0, -3))
    .filter((e) => !medidas.has(e));
}
