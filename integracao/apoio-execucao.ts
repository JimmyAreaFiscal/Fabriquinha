// Apoio comum aos testes que levam uma demanda à execução (CA-SDLC-07 em diante): pi falso com portão, despacho com as
// verificações injetadas e a demanda com o plano aprovado. Cada arquivo de teste roda no seu processo, então o pi falso é por arquivo.
import assert from "node:assert/strict";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type EntradaEvidenciaDemanda, submeterEvidenciaDemanda } from "../src/dominio/evidencia_demanda.ts";
import type { Verificacao } from "../src/evidencias/verificacoes.ts";
import { despacharDemandas, type DepsDespacho } from "../src/execucao/despacho_demanda.ts";
import { iniciarExecucaoDemanda, interromperExecucaoDemanda } from "../src/execucao/execucao_demanda.ts";
import { fecharTicketDemanda } from "../src/execucao/fechamento_ticket.ts";
import {
  aprovarPlanejamentoDemanda,
  iniciarOuRetomarPlanejamento,
  submeterPlanejamento,
} from "../src/execucao/planejamento.ts";
import { decidirRevisaoRodada } from "../src/execucao/revisao_rodada.ts";
import { comDemanda } from "../src/persistencia/demandas.ts";
import { carregarSessoesDoTicket } from "../src/persistencia/sessoes.ts";
import { base, type Cenario, ciclo, demanda, demandaAprovada, esperar } from "./apoio.ts";
import { piFalso } from "./falsos.ts";

export const pi = piFalso(base);

// O "agente" do pi falso: espera o portão (o teste o abre) e então escreve na worktree, sem submeter nada.
export const portao = join(base, "portao");
process.env.FALSO_PI_PORTAO = portao;
export const agente = join(base, "agente-portao.mjs");
writeFileSync(
  agente,
  `import { appendFileSync, existsSync } from "node:fs";
export default async () => {
  while (!existsSync(process.env.FALSO_PI_PORTAO)) await new Promise((r) => setTimeout(r, 20));
  appendFileSync("feature.txt", "linha\\n");
};
`,
);
/** Espera o portão como o `agente`, mas não escreve: o teste submete as evidências do agente enquanto ele espera. */
export const agenteMudo = join(base, "agente-mudo.mjs");
writeFileSync(
  agenteMudo,
  `import { existsSync } from "node:fs";
export default async () => {
  while (!existsSync(process.env.FALSO_PI_PORTAO)) await new Promise((r) => setTimeout(r, 20));
};
`,
);
export const fecharPortao = () => {
  rmSync(portao, { force: true });
};
export const abrirPortao = () => {
  writeFileSync(portao, "");
};
export const pisAteAgora = () => pi.chamadas().length;

const verif = (tipo: Verificacao["tipo"], aprovada: boolean): Verificacao => ({
  tipo,
  aprovada,
  falhas: aprovada ? [] : [{ classe: "tecnica", motivo: "reprovado no teste", comando: "c" }],
  dados: {},
  logs: [{ nome: `${tipo}.log`, texto: `log de ${tipo}` }],
});
export const verificacoes = (aprovada: boolean): Verificacao[] =>
  (["execucao_testes", "matriz_fitness", "relatorio_sonar"] as const).map((t) => verif(t, aprovada));

/** Despacho que roda o pi de verdade e fecha o ticket com as verificações dadas (o `aprovadas()` é lido a cada fechamento). */
export const despacho = (aprovadas: () => boolean = () => true): DepsDespacho => ({
  iniciarExecucao: (banco, t, opcoes) =>
    iniciarExecucaoDemanda(banco, t, {
      ...opcoes,
      fechar: (b, ref, r) =>
        fecharTicketDemanda(b, ref, r, { coletarVerificacoes: () => Promise.resolve(verificacoes(aprovadas())) }),
    }),
});

export interface RodadaPlano {
  depende?: number[];
  tickets: number;
}

/** Demanda aprovada, planejada e com o plano aprovado (as worktrees prontas): em `execucao`, com os tickets abertos. */
export async function demandaEmExecucao(c: Cenario, rodadas: RodadaPlano[]): Promise<string> {
  const id = demandaAprovada(c);
  pi.roteirizar();
  // Só o planejamento desta demanda: um ciclo do agendador despacharia o trabalho das outras.
  const { fim } = iniciarOuRetomarPlanejamento(c.banco, id, c.config.timeoutMin);
  await esperar(() => pi.chamadas().length >= 1, "o pi receber o prompt do planejamento");
  interromperExecucaoDemanda(c.banco, { demanda_id: id, ticket_id: 2 });
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
  submeterPlanejamento(
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
    { tipo: "agente", execucao: 1, ticket: 2 },
  );
  await aprovarPlanejamentoDemanda(c.banco, id, {});
  assert.equal(demanda(c, id).demanda.fase, "execucao");
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
  demanda(c, ref.demanda_id).tickets.find((t) => t.ticket_id === ref.ticket_id)?.status;
export const rodadaDe = (c: Cenario, id: string, n: number) => demanda(c, id).rodadas.find((r) => r.rodada_id === n);
export const execucoesDe = (c: Cenario, ref: { demanda_id: string; ticket_id: number }) =>
  carregarSessoesDoTicket(c.banco, ref).execucoes;

export const agora = () => new Date().toISOString();

/** O ticket atual (o de maior id) da etapa na rodada 1. */
export const atual = (c: Cenario, id: string, etapa: string) => {
  const t = demanda(c, id)
    .tickets.filter((x) => x.rodada_id === 1 && x.etapa === etapa)
    .sort((a, b) => b.ticket_id - a.ticket_id)[0];
  assert.ok(t, `ticket ${etapa} da rodada 1`);
  return t;
};
/** As evidências que cabem ao agente do ticket, submetidas como a ferramenta autora da demanda as enviaria. */
export function comoAgente(c: Cenario, id: string, ticket_id: number, evidencias: [string, object][]): void {
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

/** Demanda em execução com a única implementação da rodada 1 feita pelo agendador: a rodada está em `revisao`. */
export async function rodadaEmRevisao(c: Cenario): Promise<string> {
  const id = await demandaEmExecucao(c, [{ tickets: 1 }]);
  abrirPortao();
  pi.roteirizar([{ modo: "ok", agente }]);
  await ciclo(c, despacho());
  assert.equal(rodadaDe(c, id, 1)?.fase, "revisao");
  return id;
}

/** O agendador roda o `revisar_rodada` (a Fabriquinha prepara as evidências dela); depois o agente decide. */
export async function revisar(
  c: Cenario,
  id: string,
  decisao: { aprovado: true } | { aprovado: false; exigencias: string; correcoes: object[] },
): Promise<number> {
  pi.roteirizar([{ modo: "ok" }]);
  await ciclo(c, despacho());
  const { ticket_id, status } = atual(c, id, "revisar_rodada");
  assert.equal(status, "em_execucao", "a revisão espera a decisão do agente");
  if (decisao.aprovado) {
    comoAgente(c, id, ticket_id, [
      ["explicacao_fitness", { explicacoes: [] }],
      ["comprovacao_criterios", { criterios: [{ id: "CA-1", atendido: true, arquivos: [] }] }],
    ]);
  }
  decidirRevisaoRodada(
    c.banco,
    { ...decisao, demanda_id: id, rodada_id: 1, ticket_id },
    { tipo: "agente", execucao: 1, ticket: ticket_id },
  );
  return ticket_id;
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
export async function encerrar(c: Cenario, id: string): Promise<void> {
  fecharPortao();
  pi.roteirizar([{ modo: "ok", agente: agenteMudo }]);
  const fins = despacharDemandas(c.banco, c.config, despacho());
  assert.equal(fins.length, 1);
  await esperar(() => pisAteAgora() === 1, "o pi receber o prompt da documentação");
  comoAgente(c, id, atual(c, id, "encerrar_rodada").ticket_id, [
    ["mensagem_pr", MENSAGEM_PR],
    ["aula_codigo", { resumo: "aula" }],
  ]);
  abrirPortao();
  await Promise.all(fins);
}

/** Rodada 1 em `encerramento`, com a implementação revisada e aprovada. */
export async function rodadaEmEncerramento(c: Cenario): Promise<string> {
  const id = await rodadaEmRevisao(c);
  await revisar(c, id, { aprovado: true });
  assert.equal(rodadaDe(c, id, 1)?.fase, "encerramento");
  return id;
}
