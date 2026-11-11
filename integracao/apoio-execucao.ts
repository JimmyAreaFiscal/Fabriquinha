// Apoio comum aos testes que levam uma demanda à execução (CA-SDLC-07 em diante): pi falso com portão, despacho com as
// verificações injetadas e a demanda com o plano aprovado. Cada arquivo de teste roda no seu processo, então o pi falso é por arquivo.
import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { AUDITOR, type Ator } from "../src/compartilhado/nucleo/vocabulario_do_sdlc/ator.ts";
import type { RegistroDaVerificacao } from "../src/verificacao/aplicacao/coleta_das_verificacoes.ts";
import { verificacaoDeTeste } from "../apoio-testes/verificacoes_de_teste.ts";
import { Endereco } from "../src/compartilhado/nucleo/vocabulario_do_sdlc/endereco.ts";
import { decidirGate } from "../src/etapas/gates.ts";
import { cicloDoDespacho, type DepsDespacho } from "../src/sdlc/aplicacao/despacho/despacho.ts";
import { despachoDasEtapas } from "../src/etapas/conducoes.ts";
import { interromperExecucaoDemanda } from "../src/sdlc/aplicacao/execucao/execucao_demanda.ts";
import { ConducaoDePlanejar } from "../src/etapas/planejar/conducao_de_planejar.ts";
import { relogioDoSistema } from "../src/compartilhado/nucleo/relogio.ts";
import { condutor } from "../src/trabalho_agentico/aplicacao/trabalho/condutor.ts";
import { anotar } from "../src/compartilhado/infra/registro.ts";
import { comDemanda } from "../src/sdlc/armazenamento/demandas.ts";
import { carregarTrabalhosDoTicket } from "../src/trabalho_agentico/armazenamento/trabalho_agentico.ts";
import { base, type Cenario, ciclo, demanda, demandaAprovada, esperar, proporPlanoDoAgente } from "./apoio.ts";
import { comEvidencia } from "../apoio-testes/cenarios_de_demanda.ts";
import { instalarPiFalso, type PassoPi } from "../apoio-testes/pi_falso.ts";

export const pi = instalarPiFalso(base);

/**
 * Os módulos do "agente" do pi falso, em `pasta`: esperam o portão (o arquivo `portao` ao lado deles, que o teste abre,
 * e não uma variável de ambiente, que o pi no container não recebe). `agente` então escreve na worktree, sem submeter
 * nada; `agenteMudo` não escreve: o teste submete as evidências do agente enquanto ele espera.
 */
function gravarModulosDoAgente(pasta: string) {
  const modulos = {
    portao: join(pasta, "portao"),
    agente: join(pasta, "agente-portao.mjs"),
    agenteMudo: join(pasta, "agente-mudo.mjs"),
  };
  const esperarOPortao = `  const portao = new URL("portao", import.meta.url);
  while (!existsSync(portao)) await new Promise((r) => setTimeout(r, 20));`;
  writeFileSync(
    modulos.agente,
    `import { appendFileSync, existsSync } from "node:fs";
export default async () => {
${esperarOPortao}
  appendFileSync("feature.txt", "linha\\n");
};
`,
  );
  writeFileSync(
    modulos.agenteMudo,
    `import { existsSync } from "node:fs";
export default async () => {
${esperarOPortao}
};
`,
  );
  return modulos;
}
const modulosDoArquivoDeTeste = gravarModulosDoAgente(base);
export const { portao, agente, agenteMudo } = modulosDoArquivoDeTeste;

// Onde o pi falso e o portão valem agora: a pasta do arquivo de teste ou, depois de `levarPiFalsoParaOContainer`, o container.
let piEPortaoEmUso = { pi, ...modulosDoArquivoDeTeste };

/**
 * Leva o pi falso, o roteiro, o registro, o portão e os módulos do agente para `pasta`, que o container monta no mesmo
 * caminho (`.git/objects/pi-falso` do repositório), e faz o core chamar o `pi` da imagem do projeto de teste em vez do arquivo do host.
 * Devolve o pi falso de lá: o teste o roteiriza e lê o registro dele.
 */
export function levarPiFalsoParaOContainer(pasta: string) {
  mkdirSync(pasta, { recursive: true });
  const piDoContainer = instalarPiFalso(pasta);
  piEPortaoEmUso = { pi: piDoContainer, ...gravarModulosDoAgente(pasta) };
  process.env.FABRIQUINHA_PI = "pi";
  return piDoContainer;
}

export const fecharPortao = () => {
  rmSync(piEPortaoEmUso.portao, { force: true });
};
export const abrirPortao = () => {
  writeFileSync(piEPortaoEmUso.portao, "");
};
export const pisAteAgora = () => piEPortaoEmUso.pi.prompts().length;

export const verificacoes = (passou: boolean): RegistroDaVerificacao[] =>
  (["execucao_testes", "matriz_fitness", "relatorio_sonar"] as const).map((t) => verificacaoDeTeste(t, passou));

/** Despacho que roda o pi de verdade e fecha o ticket com as verificações dadas (o `passaram()` é lido a cada fechamento). */
const implementacaoComVerificacoes = (passaram: () => boolean) => ({
  coletarVerificacoes: () => Promise.resolve(verificacoes(passaram())),
});

export const despacho = (passaram: () => boolean = () => true): DepsDespacho =>
  despachoDasEtapas({ implementacao: implementacaoComVerificacoes(passaram) });

export interface RodadaPlano {
  depende?: number[];
  tickets: number;
}

const PASSO_DO_PLANEJAMENTO: PassoPi = { uso: null };

/**
 * Demanda aprovada que o `planejar` planejou: o plano está submetido e a demanda espera o Auditor em `gate_planejamento`.
 * O pi do planejamento é interrompido pelo teste; com `passoDoPi.sai`, ele sai sozinho ao receber o prompt (o pi no
 * container não é interrompido por sinal do serviço) e a execução termina sem decidir nada, como a interrompida.
 */
export async function planejarDemanda(
  c: Cenario,
  id: string,
  rodadas: RodadaPlano[],
  passoDoPi: PassoPi = PASSO_DO_PLANEJAMENTO,
): Promise<void> {
  piEPortaoEmUso.pi.roteirizar([passoDoPi]);
  // Só o planejamento desta demanda: um ciclo do agendador despacharia o trabalho das outras.
  const fim = new ConducaoDePlanejar({
    banco: c.banco,
    relogio: relogioDoSistema,
    condutor,
    registro: anotar,
  }).conduzir(Endereco.doTicket(id, 2));
  await esperar(() => piEPortaoEmUso.pi.prompts().length >= 1, "o pi receber o prompt do planejamento");
  if (!passoDoPi.sai) interromperExecucaoDemanda(c.banco, { demanda_id: id, ticket_id: 2 });
  await fim;
  let ticket_id = 0;
  const tickets = rodadas.flatMap((r, i) =>
    Array.from({ length: r.tickets }, (_, j) => ({
      demanda_id: id,
      ticket_id: ++ticket_id,
      rodada_id: i + 1,
      titulo: `Ticket ${String(i + 1)}.${String(j + 1)}`,
      descricao: "d",
    })),
  );
  proporPlanoDoAgente(
    c.banco,
    id,
    {
      demanda_id: id,
      criterios: ["CA-1"],
      rodadas: rodadas.map((r, i) => ({
        demanda_id: id,
        rodada_id: i + 1,
        titulo: `Rodada ${String(i + 1)}`,
        e2e: false,
        criterios: ["CA-1"],
        depende: (r.depende ?? []).map((rodada_id) => ({ demanda_id: id, rodada_id })),
      })),
      tickets,
    },
    { tipo: "agente", trabalho_id: "execucao-1" },
  );
  assert.equal(demanda(c, id).demanda.estado, "gate_planejamento");
}

/** Demanda aprovada, planejada e com o plano aprovado (as worktrees prontas): em `em_execucao`, com os tickets abertos. */
export async function demandaEmExecucao(
  c: Cenario,
  rodadas: RodadaPlano[],
  passoDoPiDoPlanejamento?: PassoPi,
): Promise<string> {
  const id = await demandaAprovada(c);
  await planejarDemanda(c, id, rodadas, passoDoPiDoPlanejamento);
  await decidirGate(c.banco, "gate_planejamento", Endereco.daDemanda(id), { resultado: "aprovado" }, AUDITOR);
  assert.equal(demanda(c, id).demanda.estado, "em_execucao");
  return id;
}

/** O ticket `implementar` da rodada, o `n`-ésimo (de 1). */
export const ticketDe = (c: Cenario, id: string, rodada: number, n = 1) => {
  const t = demanda(c, id)
    .tickets.filter((x) => x.etapa === "implementar" && x.rodada_id === rodada)
    .sort((a, b) => a.ticket_id - b.ticket_id)[n - 1];
  assert.ok(t, `ticket ${String(n)} da rodada ${String(rodada)}`);
  return { demanda_id: id, ticket_id: t.ticket_id };
};
export const statusDe = (c: Cenario, ref: { demanda_id: string; ticket_id: number }) =>
  demanda(c, ref.demanda_id).tickets.find((t) => t.ticket_id === ref.ticket_id)?.estado;
export const rodadaDe = (c: Cenario, id: string, n: number) => demanda(c, id).rodadas.find((r) => r.rodada_id === n);
export const execucoesDe = (c: Cenario, ref: { demanda_id: string; ticket_id: number }) =>
  carregarTrabalhosDoTicket(c.banco, ref).execucoes;

export const agora = () => new Date().toISOString();

/** O ticket atual (o de maior id) da etapa na rodada (a 1, por padrão). */
export const atual = (c: Cenario, id: string, etapa: string, rodada = 1) => {
  const t = demanda(c, id)
    .tickets.filter((x) => x.rodada_id === rodada && x.etapa === etapa)
    .sort((a, b) => b.ticket_id - a.ticket_id)[0];
  assert.ok(t, `ticket ${etapa} da rodada ${String(rodada)}`);
  return t;
};
/** As evidências que cabem ao agente do ticket, submetidas como a ferramenta autora da demanda as enviaria. */
export function comoAgente(c: Cenario, id: string, ticket_id: number, evidencias: [string, object][]): void {
  comDemanda(c.banco, id, (ag) =>
    evidencias.reduce(
      (a, [tipo, dados]) => comEvidencia(a, { tipo, dados, ticket_id } as never, a.demanda.criada_por, agora()),
      ag,
    ),
  );
}

/** Demanda em execução com a única implementação da rodada 1 feita pelo agendador: a rodada está em `revisao`. */
export async function rodadaEmRevisao(c: Cenario): Promise<string> {
  const id = await demandaEmExecucao(c, [{ tickets: 1 }]);
  abrirPortao();
  pi.roteirizar([{ agente, uso: null }]);
  await ciclo(c, despacho());
  assert.equal(rodadaDe(c, id, 1)?.estado, "revisar_rodada");
  return id;
}

/**
 * Despacha com o pi falso parado no portão: `agir` faz o papel do agente enquanto a execução segue aberta, como o
 * agente de verdade, que submete e decide antes de o pi sair (sem decisão, a revisão falha).
 */
export async function despacharComAgente(
  c: Cenario,
  deps: DepsDespacho,
  agir: () => Promise<void> | void,
): Promise<void> {
  fecharPortao();
  piEPortaoEmUso.pi.roteirizar([{ agente: piEPortaoEmUso.agenteMudo, uso: null }]);
  const fins = cicloDoDespacho(c.banco, c.config, deps);
  assert.ok(fins.length > 0);
  await esperar(() => pisAteAgora() === fins.length, "cada pi receber o prompt");
  await agir();
  abrirPortao();
  await Promise.all(fins);
}

/** O Agente da execução aberta do ticket: o `trabalho_id` é o `processo_do_trabalho.id` dela. */
export function agenteDaExecucaoAberta(c: Cenario, ref: { demanda_id: string; ticket_id: number }): Ator {
  const aberta = execucoesDe(c, ref).find((e) => !e.fim);
  assert.ok(aberta, "o agente age com a execução do ticket aberta");
  return { tipo: "agente", trabalho_id: aberta.id };
}

type DecisaoDaRevisao = { resultado: "aprovado" } | { resultado: "reprovado"; motivo: string; correcoes: object[] };

/** O agente da revisão da `rodada`, com a execução aberta: as evidências (se aprova) e a decisão. */
export async function decidirComoRevisor(
  c: Cenario,
  id: string,
  decisao: DecisaoDaRevisao,
  rodada = 1,
): Promise<number> {
  const { ticket_id, estado: status } = atual(c, id, "revisar_rodada", rodada);
  assert.equal(status, "em_execucao", "a revisão espera a decisão do agente");
  if (decisao.resultado === "aprovado") {
    comoAgente(c, id, ticket_id, [
      ["explicacao_fitness", { explicacoes: [] }],
      ["comprovacao_criterios", { criterios: [{ id: "CA-1", atendido: true, arquivos: [] }] }],
    ]);
  }
  await decidirGate(
    c.banco,
    "gate_revisao_rodada",
    Endereco.daRodada(id, rodada),
    decisao,
    agenteDaExecucaoAberta(c, { demanda_id: id, ticket_id }),
  );
  return ticket_id;
}

/** O agendador roda o `revisar_rodada` (a Fabriquinha prepara as evidências dela) e o agente decide durante a execução. */
export async function revisar(c: Cenario, id: string, decisao: DecisaoDaRevisao, rodada = 1): Promise<number> {
  let revisor = 0;
  await despacharComAgente(c, despacho(), async () => {
    revisor = await decidirComoRevisor(c, id, decisao, rodada);
  });
  return revisor;
}

export const MENSAGEM_PR = {
  titulo: "Encerrar a rodada",
  oQueMudou: "Conduz o encerramento.",
  decisoesNaoObvias: [],
  naoFeito: [],
  comoRevisar: ["Leia o diff."],
  naoVerificado: [],
};

/** O agendador roda o `encerrar_rodada`: o agente documenta (enquanto o pi espera) e a Fabriquinha publica e confere o PR. */
export async function encerrar(c: Cenario, id: string, rodada = 1): Promise<void> {
  await despacharComAgente(c, despacho(), () => {
    comoAgente(c, id, atual(c, id, "encerrar_rodada", rodada).ticket_id, [
      ["mensagem_pr", MENSAGEM_PR],
      ["aula_codigo", { resumo: "aula" }],
    ]);
  });
}

/** Rodada 1 em `encerramento`, com a implementação revisada e aprovada. */
export async function rodadaEmEncerramento(c: Cenario): Promise<string> {
  const id = await rodadaEmRevisao(c);
  await revisar(c, id, { resultado: "aprovado" });
  assert.equal(rodadaDe(c, id, 1)?.estado, "encerrar_rodada");
  return id;
}

/** O despacho com a espera do PR encurtada: o `gh` falso responde na hora. */
export const despachoComEsperaCurta = (): DepsDespacho =>
  despachoDasEtapas({
    implementacao: implementacaoComVerificacoes(() => true),
    verificacao: { intervaloMs: 1, carenciaMs: 0, limiteMs: 5000 },
  });

/** O ticket mais novo da etapa na demanda (sem rodada, como o `revisar_demanda`). */
const ultimoDaEtapa = (c: Cenario, id: string, etapa: string) =>
  demanda(c, id)
    .tickets.filter((t) => t.etapa === etapa)
    .at(-1);

/** Revisão integral: o agendador inicia e conduz a etapa; o agente (o teste) submete as evidências e decide durante a execução. */
export async function revisaoIntegral(
  c: Cenario,
  id: string,
  decisao: "aprovada" | { motivo: string },
): Promise<number> {
  let revisor = 0;
  await despacharComAgente(c, despachoComEsperaCurta(), async () => {
    const ticket = ultimoDaEtapa(c, id, "revisar_demanda");
    assert.equal(ticket?.estado, "em_execucao", "a revisão integral espera a decisão do agente");
    const { ticket_id } = ticket;
    revisor = ticket_id;
    const agenteDoTicket = agenteDaExecucaoAberta(c, { demanda_id: id, ticket_id });
    if (decisao === "aprovada") {
      comoAgente(c, id, ticket_id, [
        ["comprovacao_criterios", { criterios: [{ id: "CA-1", atendido: true, arquivos: [] }] }],
        ["testes_estresse", { aplicavel: false, cenarios: [], justificativa: "sem carga" }],
        ["analise_seguranca", { aplicavel: false, ameacas: [], achados: [], justificativa: "sem superfície" }],
      ]);
      await decidirGate(
        c.banco,
        "gate_revisao_demanda",
        Endereco.daDemanda(id),
        { resultado: "aprovado" },
        agenteDoTicket,
      );
    } else {
      const plano = {
        demanda_id: id,
        criterios: ["CA-1"],
        rodadas: [{ demanda_id: id, rodada_id: 1, titulo: "Corrigir o agregado", e2e: false, criterios: ["CA-1"] }],
        tickets: [{ demanda_id: id, ticket_id: 1, rodada_id: 1, titulo: "Corrigir a integração", descricao: "d" }],
      };
      await decidirGate(
        c.banco,
        "gate_revisao_demanda",
        Endereco.daDemanda(id),
        { resultado: "reprovado", motivo: decisao.motivo, correcoes: plano },
        agenteDoTicket,
      );
    }
  });
  return revisor;
}

/** Aprova o PR que o encerramento da rodada publicou, como o Auditor, e integra a rodada na demanda. */
export async function aprovarRodada(c: Cenario, id: string, rodada: number): Promise<void> {
  await decidirGate(c.banco, "gate_pr", Endereco.daRodada(id, rodada), { resultado: "aprovado", nota: 4 }, AUDITOR);
  assert.equal(rodadaDe(c, id, rodada)?.estado, "concluida");
}
