// Serviço Execução da demanda (comparacao-sdlc-implementacao.md §§4.1, 4.2, 6 e 7.3): junta sessão, execução, worktree,
// prompt e pi para um ticket da demanda. Conduz a execução; o ticket só muda pelo fechamento (`fechamento_ticket.ts`).
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { FABRIQUINHA } from "../nucleo/ator.ts";
import type { ModoExecucao } from "../nucleo/sessoes.ts";
import type { AgregadoDemanda, TicketDemanda } from "../nucleo/agregado_demanda.ts";
import { resolverConfiguracaoAgente } from "../nucleo/configuracao_agente.ts";
import type { Projeto } from "../nucleo/projeto.ts";
import { formatarTicketRef } from "../nucleo/demanda.ts";
import { encontrado, existe, mensagem } from "../nucleo/erros.ts";
import { iniciarTentativaDoTicket } from "../nucleo/reserva_ticket.ts";
import {
  type FalhaDaTentativa,
  falhaDoErro,
  falhaInterrompidaPeloAuditor,
  falhaPorServicoReiniciado,
  falhaQueExigeOAuditor,
} from "../nucleo/tentativa.ts";
import {
  criarSessao,
  encerrarExecucao,
  iniciarExecucao,
  registrarUso,
  retomarSessao,
  type ExecucaoSessao,
  type Sessao,
  type UsoModeloExecucao,
} from "../nucleo/sessoes.ts";
import { varrerBase } from "./retrabalho.ts";
import { somar } from "../nucleo/uso.ts";
import { raizDo } from "../armazenamento/banco.ts";
import { carregarProjeto } from "../armazenamento/projetos.ts";
import { caminhoArquivo } from "../armazenamento/arquivos.ts";
import { carregarDemanda, comDemanda } from "../armazenamento/demandas.ts";
import { commitDoTicketDemanda } from "../armazenamento/commits_demanda.ts";
import { anexosDaDemanda } from "../armazenamento/evidencia_demanda.ts";
import { anotar, arquivoDaSessao } from "../infra/registro.ts";
import {
  carregarSessoesDaDemanda,
  carregarSessoesDoTicket,
  comSessoesDoTicket,
  execucoesAbertasDaDemanda,
} from "../armazenamento/sessoes.ts";
import { sinalNoGrupo } from "../infra/processo.ts";
import { garantirWorktreeDemanda, garantirWorktreeRodada } from "../infra/repositorio/worktree-demanda.ts";
import { fecharTicketDemanda, falharTicketDemanda } from "./fechamento_ticket.ts";
import { triarPergunta } from "./auditor_automatico.ts";
import { avisar, rodarPi } from "./gerente.ts";
import { ambientePi, confianca } from "../infra/agente/pi.ts";
import { argumentosPiDemanda } from "./pi_demanda.ts";
import { type ContextoDemanda, montarPromptDemanda } from "./prompt_demanda.ts";
import { perguntasRespondidasNaSessao } from "./sessoes_demanda.ts";

type TicketRef = Pick<Sessao, "demanda_id" | "ticket_id">;

export interface OpcoesExecucaoDemanda {
  limiteMin: number;
  modo?: Exclude<ModoExecucao, "consulta">;
  /** Devolução ou reabertura do Auditor: o motivo vai ao prompt. */
  retomada?: ContextoDemanda["retomada"];
  /** Abre sessão nova mesmo com sessão no ticket: a conversa anterior foi descartada (plano aprovado e reaberto). */
  iniciarEmSessaoNova?: boolean;
  /** Mensagem do Auditor ao retomar a sessão interativa: é o prompt da execução, sem remontar o contexto. */
  mensagem?: string;
  /** Fechamento do ticket depois do encerramento; injetável nos testes (padrão: `fecharTicketDemanda`). */
  fechar?: typeof fecharTicketDemanda;
}

/** Execuções com condutor vivo neste serviço, por id, com o grupo de processo do pi depois de lançado. */
const ativas = new Map<string, { pgid?: number; interrompida?: boolean }>();

/** Os condutores em curso: o `parar` do serviço os espera antes de fechar o banco. */
const condutores = new Set<Promise<unknown>>();
/** Desde o início do `parar`, o pi que sai é efeito da parada do serviço. */
let parando = false;

interface Conducao {
  banco: DatabaseSync;
  ref: TicketRef;
  ag: AgregadoDemanda;
  ticket: TicketDemanda;
  projeto: Projeto;
  sessao: Sessao;
  execucao: ExecucaoSessao;
  opcoes: OpcoesExecucaoDemanda;
}

/** O ticket de rodada roda na worktree da rodada; o global (sem rodada), na da demanda. */
function worktreeDoTicket({ banco, ag, ticket, projeto }: Conducao, log: string): Promise<string> {
  const raiz = raizDo(banco);
  return ticket.rodada_id === undefined
    ? garantirWorktreeDemanda(raiz, projeto, ag.demanda.id, log, () => varrerBase(banco, projeto.nome))
    : garantirWorktreeRodada(raiz, projeto, { demanda_id: ag.demanda.id, rodada_id: ticket.rodada_id }, log);
}

/** Grava o grupo de processo do pi para o reinício do serviço poder interrompê-lo (§4.2). */
function gravarGrupo({ banco, ref, execucao }: Conducao, pgid: number): void {
  const viva = { ...ativas.get(execucao.id), pgid };
  ativas.set(execucao.id, viva);
  // Interrompida durante a preparação: o pi que acaba de subir recebe o término já.
  if (viva.interrompida) sinalNoGrupo(pgid, "SIGTERM");
  comSessoesDoTicket(banco, ref, (estado) => ({
    ...estado,
    execucoes: estado.execucoes.map((e) => (e.id === execucao.id ? { ...e, grupo_processo: pgid } : e)),
  }));
}

type Encerravel = Pick<Conducao, "banco" | "ref" | "sessao" | "execucao">;

/** O uso por modelo da janela da execução; custo ausente ou parcial fica nulo, nunca zero. */
function coletarUso(c: Encerravel, fim: string, log: string): UsoModeloExecucao[] {
  try {
    const arquivo = arquivoDaSessao(raizDo(c.banco), c.sessao.id);
    const somas = arquivo ? somar(readFileSync(arquivo, "utf8"), Date.parse(c.execucao.inicio), Date.parse(fim)) : [];
    return somas.map((s) => ({
      execucao_id: c.execucao.id,
      modelo_provedor: s.provedor,
      modelo_nome: s.modelo,
      tokens_entrada: s.input,
      tokens_saida: s.output,
      tokens_cache_leitura: s.cacheRead,
      tokens_cache_escrita: s.cacheWrite,
      ...(!s.semCusto && { custo: s.custo }),
    }));
  } catch (error_) {
    // Métrica nunca impede o encerramento.
    anotar(log, `coleta de uso falhou: ${mensagem(error_)}`);
    return [];
  }
}

/** O único escritor do encerramento: fim, falha e uso na mesma transação; não toca ticket, etapa nem gate. */
function encerrar(c: Encerravel, falhou: boolean, log: string): void {
  const fim = new Date().toISOString();
  const usos = coletarUso(c, fim, log);
  comSessoesDoTicket(c.banco, c.ref, (estado) => ({
    ...estado,
    execucoes: encerrarExecucao(estado.execucoes, c.execucao.id, fim, falhou),
    usos: usos.reduce((acc, u) => registrarUso(acc, u), estado.usos),
  }));
}

/** As perguntas respondidas nas sessões de cada ticket anterior da rodada que foi recusado, por ticket (só a revisão da rodada as lê). */
function perguntasDosTicketsRecusadosDaRodada({
  banco,
  ag,
  ticket,
}: Conducao): ContextoDemanda["perguntasDasRevisoesAnteriores"] {
  const raiz = raizDo(banco);
  const { sessoes } = carregarSessoesDaDemanda(banco, ag.demanda.id);
  const idsDaRodada = new Set(ag.tickets.filter((t) => t.rodada_id === ticket.rodada_id).map((t) => t.ticket_id));
  return new Map(
    ag.decisoes
      .filter((d) => d.resultado === "recusado" && d.ticket_id < ticket.ticket_id && idsDaRodada.has(d.ticket_id))
      .map((d) => [
        d.ticket_id,
        sessoes.filter((s) => s.ticket_id === d.ticket_id).flatMap((s) => perguntasRespondidasNaSessao(raiz, s.id)),
      ]),
  );
}

/** O SHA do commit de cada ticket da demanda que tem um (as revisões leem o que a Fabriquinha já verificou nele). */
function commitsDosTickets({ banco, ag }: Conducao): ContextoDemanda["commitsDosTickets"] {
  return new Map(
    ag.tickets.flatMap((t) => {
      const commit = commitDoTicketDemanda(banco, ag.demanda.id, t.ticket_id);
      return commit ? [[t.ticket_id, commit.sha] as const] : [];
    }),
  );
}

async function conduzir(c: Conducao): Promise<FalhaDaTentativa | undefined> {
  const raiz = raizDo(c.banco);
  const { execucao, sessao, projeto, opcoes } = c;
  const dir = join(raiz, "execucoes", `E-${execucao.id}`);
  const log = join(dir, "log");
  let falha: FalhaDaTentativa | undefined;
  try {
    // `gh` e `az` olham diretórios vazios: o agente não acha credencial de hospedagem.
    for (const sub of ["saida", "vazio"]) mkdirSync(join(dir, sub), { recursive: true });
    anotar(log, `E-${execucao.id} iniciada: ${c.ref.demanda_id}.T${String(c.ref.ticket_id)}, sessão ${sessao.id}`);
    const worktree = await worktreeDoTicket(c, log);
    const prompt =
      opcoes.mensagem ??
      montarPromptDemanda({
        ag: c.ag,
        ticket: c.ticket,
        projeto: { nome: projeto.nome, branch_base: projeto.branch_base },
        worktree,
        saida: join(dir, "saida"),
        retomada: opcoes.retomada,
        ...(c.ticket.etapa === "revisar_rodada" && {
          perguntasDasRevisoesAnteriores: perguntasDosTicketsRecusadosDaRodada(c),
        }),
        commitsDosTickets: commitsDosTickets(c), // só as revisões leem
        anexos: anexosDaDemanda(c.banco, c.ref.demanda_id).map((a) => ({
          ...a,
          caminho: caminhoArquivo(c.banco, a.sha256),
        })),
      });
    writeFileSync(join(dir, "prompt.md"), prompt);
    const args = argumentosPiDemanda({
      raiz,
      sessaoPi: sessao.id,
      confianca: confianca(projeto.raiz_git),
      modo: sessao.modo,
      ticket: c.ticket,
      etapasDoProjeto: projeto.etapas,
    });
    // Parada em curso durante a preparação: não lança um pi novo; a falha vira reinício do serviço abaixo.
    if (parando) throw new Error("o serviço está parando");
    anotar(log, `pi ${args.join(" ")}`);
    falha = await rodarPi({
      execucao: { id: execucao.id, sessaoPi: sessao.id, modo: sessao.modo },
      args,
      cwd: worktree,
      env: ambientePi(raiz, execucao.id, dir),
      log,
      prompt,
      limiteMin: opcoes.limiteMin,
      triarPergunta: (pergunta) =>
        triarPergunta(
          execucao.configuracao_agente?.modelo,
          { ticket: formatarTicketRef(c.ref), etapa: c.ticket.etapa, demanda: c.ag.demanda.titulo },
          pergunta,
        ),
      // Sem pid (o pi nem subiu) não há grupo a gravar; o `saiu` do pi relata o erro.
      aoLancar: (pgid) => {
        if (Number.isInteger(pgid)) gravarGrupo(c, pgid);
      },
    });
  } catch (error_) {
    falha = falhaDoErro(error_);
    anotar(log, `preparação falhou: ${falha.motivo}`);
  }
  // Interrompida pelo Auditor: o pi saiu pelo SIGTERM, mas a causa verdadeira é a interrupção.
  if (ativas.get(execucao.id)?.interrompida) falha = falhaInterrompidaPeloAuditor;
  else if (parando) falha = falhaPorServicoReiniciado;
  ativas.delete(execucao.id);
  encerrar(c, falha !== undefined, log);
  try {
    await (opcoes.fechar ?? fecharTicketDemanda)(
      c.banco,
      c.ref,
      { falha },
      {
        parada: () => parando,
      },
    );
  } catch (error_) {
    anotar(log, `fechamento falhou: ${mensagem(error_)}`);
    try {
      falharTicketDemanda(c.banco, c.ref, falhaQueExigeOAuditor(`fechamento falhou: ${mensagem(error_)}`));
    } catch (erroFalha) {
      anotar(log, `falhar o ticket também falhou: ${mensagem(erroFalha)}`);
    }
  }
  // O último `estado` do SSE sai com o pi, antes do fim gravado e do fechamento: o chat precisa do cabeçalho novo.
  avisar(sessao.id, log);
  return falha;
}

/**
 * Inicia o ticket da demanda (sessão nova) ou o retoma (a sessão mais recente e a conversa dela, §7.3). Síncrona até
 * gravar a execução aberta: a recusa lança já. O pi roda em segundo plano; `fim` resolve com a execução encerrada e o
 * uso gravado.
 */
export function iniciarExecucaoDemanda(
  banco: DatabaseSync,
  ref: TicketRef,
  opcoes: OpcoesExecucaoDemanda,
): { id: string; fim: Promise<FalhaDaTentativa | undefined> } {
  const ag = carregarDemanda(banco, ref.demanda_id);
  const ticket = encontrado(
    ag.tickets.find((t) => t.ticket_id === ref.ticket_id),
    `o ticket ${ref.demanda_id}.T${String(ref.ticket_id)} não existe`,
    "confira o endereço do ticket",
  );
  const projeto = carregarProjeto(banco, ag.demanda.projeto);
  const configuracaoAgente = resolverConfiguracaoAgente({
    ticket: ticket.configuracao_agente,
    etapaDoProjeto: projeto.etapas.find((e) => e.etapa === ticket.etapa)?.configuracao_agente,
    padrao: {},
  });
  const abrir = (sessao_id: string): ExecucaoSessao => ({
    id: randomUUID(),
    sessao_id,
    inicio: new Date().toISOString(),
    falha: false,
    configuracao_agente: configuracaoAgente,
  });
  let sessao!: Sessao;
  let execucao!: ExecucaoSessao;
  comSessoesDoTicket(banco, ref, (estado) => {
    // Com mais de uma sessão no ticket, retoma-se a mais recente.
    const existente = opcoes.iniciarEmSessaoNova ? undefined : estado.sessoes.at(-1);
    if (existente) {
      sessao = existente;
      execucao = abrir(sessao.id);
      return { ...estado, execucoes: retomarSessao(estado.sessoes, estado.execucoes, execucao) };
    }
    const id = randomUUID();
    sessao = {
      demanda_id: ref.demanda_id,
      ticket_id: ref.ticket_id,
      id,
      modo: opcoes.modo ?? "autonomo",
      conversa_referencia: id,
    };
    execucao = abrir(id);
    const sessoes = criarSessao(estado.sessoes, sessao);
    return { ...estado, sessoes, execucoes: iniciarExecucao(sessoes, estado.execucoes, execucao) };
  });
  comDemanda(banco, ref.demanda_id, (a) =>
    iniciarTentativaDoTicket(a, { ticket_id: ref.ticket_id, processo_id: execucao.id }, FABRIQUINHA, {
      agora: execucao.inicio,
    }),
  );
  ativas.set(execucao.id, {});
  const fim = conduzir({ banco, ref, ag, ticket, projeto, sessao, execucao, opcoes });
  condutores.add(fim);
  const sair = () => condutores.delete(fim);
  fim.then(sair, sair);
  return { id: execucao.id, fim };
}

/** O `parar` do serviço chama antes de qualquer `await`: o condutor que acordar depois grava "serviço reiniciado". */
export function marcarParada(): void {
  parando = true;
}

/**
 * Parada do serviço: espera os condutores em curso por até `limiteMs`, para gravarem o fim da execução com o banco
 * ainda aberto. Passado o limite, mata o grupo dos pi que restaram (SIGKILL) e espera os condutores gravarem a falha:
 * quem falha por causa da parada termina como "serviço reiniciado". A espera depois do SIGKILL também tem limite
 * (`aposKillMs`): o condutor fora do pi (preparação, verificações) pode não acordar; então volta assim mesmo, e a
 * subida seguinte marca o ticket como "serviço reiniciado".
 */
export async function aguardarCondutores(limiteMs: number, aposKillMs = 2000): Promise<void> {
  marcarParada();
  const esperar = async (ms: number) => {
    let timer: NodeJS.Timeout | undefined;
    const limite = new Promise<"limite">((pronto) => {
      timer = setTimeout(pronto, ms, "limite");
    });
    const resultado = await Promise.race([Promise.allSettled(condutores), limite]);
    clearTimeout(timer);
    return resultado;
  };
  if ((await esperar(limiteMs)) === "limite") {
    for (const { pgid } of ativas.values()) if (pgid !== undefined) sinalNoGrupo(pgid, "SIGKILL");
    await esperar(aposKillMs);
  }
  parando = false;
}

/**
 * Interrompe a execução aberta do ticket. Com condutor vivo, o SIGTERM no grupo faz o condutor gravar a falha; órfã
 * (sem condutor, ex.: serviço reiniciado), SIGKILL e encerra direto. Sem execução aberta, recusa antes de escrever.
 */
export function interromperExecucaoDemanda(banco: DatabaseSync, ref: TicketRef): void {
  const { execucoes } = carregarSessoesDoTicket(banco, ref);
  const execucao = existe(
    execucoes.find((e) => e.fim == null),
    `o ticket ${ref.demanda_id}.T${String(ref.ticket_id)} não tem execução em andamento`,
    "só se interrompe uma execução aberta",
  );
  const viva = ativas.get(execucao.id);
  if (viva) {
    viva.interrompida = true;
    if (viva.pgid !== undefined) sinalNoGrupo(viva.pgid, "SIGTERM");
    return;
  }
  encerrarOrfa(banco, ref, execucao.id, falhaInterrompidaPeloAuditor);
}

/** Execução aberta sem condutor: SIGKILL no grupo gravado, encerra com falha e falha o ticket em execução, sem tocar etapa nem gate. */
function encerrarOrfa(banco: DatabaseSync, ref: TicketRef, id: string, falha: FalhaDaTentativa): void {
  const { sessoes, execucoes } = carregarSessoesDoTicket(banco, ref);
  const execucao = existe(
    execucoes.find((e) => e.id === id),
    `a execução ${id} não existe`,
    "confira o banco",
  );
  if (execucao.grupo_processo != null) sinalNoGrupo(execucao.grupo_processo, "SIGKILL");
  const sessao = existe(
    sessoes.find((s) => s.id === execucao.sessao_id),
    `a execução ${id} não tem sessão`,
    "confira o banco",
  );
  const log = join(raizDo(banco), "execucoes", `E-${id}`, "log");
  encerrar({ banco, ref, sessao, execucao }, true, log);
  falharTicketDemanda(banco, ref, falha);
  avisar(sessao.id, log);
}

/** Reinício do serviço (§4.2): toda execução aberta é de uma instância anterior e falha, sem avançar etapa nem gate. */
export function recuperarExecucoesDemanda(banco: DatabaseSync): void {
  for (const { id, demanda_id, ticket_id } of execucoesAbertasDaDemanda(banco)) {
    encerrarOrfa(banco, { demanda_id, ticket_id }, id, falhaPorServicoReiniciado);
  }
  // Execução já encerrada e fechamento interrompido (coleta, ou entre o commit e a conclusão): sem execução aberta, o
  // ticket `em_execucao` não sairia mais (o `planejar` fica de fora: a retomada do despacho o assume; o gate do PR também). ponytail: falha em vez de repetir o fechamento; repetir fica para quando pedirem.
  const presos = banco
    .prepare(
      `SELECT demanda_id, ticket_id FROM ticket_demanda t WHERE estado = 'em_execucao' AND (
         etapa IN ('implementar', 'resolver_conflito', 'encerrar_demanda', 'revisar_rodada', 'revisar_demanda')
         OR (etapa = 'encerrar_rodada' AND EXISTS (SELECT 1 FROM rodada r
           WHERE r.demanda_id = t.demanda_id AND r.rodada_id = t.rodada_id AND r.estado = 'encerrar_rodada')))`,
    )
    .all() as unknown as TicketRef[];
  for (const { demanda_id, ticket_id } of presos) {
    falharTicketDemanda(banco, { demanda_id, ticket_id }, falhaPorServicoReiniciado);
  }
}
