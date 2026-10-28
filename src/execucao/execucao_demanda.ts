// Serviço Execução da demanda (comparacao-sdlc-implementacao.md §§4.1, 4.2, 6 e 7.3): junta sessão, execução, worktree,
// prompt e pi para um ticket da demanda. Conduz a execução; o ticket só muda pelo fechamento (`fechamento_ticket.ts`).
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { ModoExecucao } from "../dominio/agregado.ts";
import type { AgregadoDemanda, TicketDemanda } from "../dominio/agregado_demanda.ts";
import type { Projeto } from "../dominio/configuracao_projeto.ts";
import { encontrado, existe, mensagem } from "../dominio/erros.ts";
import { resolverModeloEffort } from "../dominio/resolucao_ticket.ts";
import {
  criarSessao,
  encerrarExecucao,
  iniciarExecucao,
  registrarUso,
  retomarSessao,
  type ExecucaoSessao,
  type Sessao,
  type UsoModeloExecucao,
} from "../dominio/sessoes.ts";
import { varrerBase } from "../metricas/retrabalho.ts";
import { somar } from "../metricas/uso.ts";
import { raizDo } from "../persistencia/banco.ts";
import { configuracaoProjeto } from "../persistencia/configuracao_projeto.ts";
import { carregarDemanda } from "../persistencia/demandas.ts";
import { anotar, arquivoDaSessao } from "../persistencia/execucoes.ts";
import { carregarSessoesDoTicket, comSessoesDoTicket, execucoesAbertasDaDemanda } from "../persistencia/sessoes.ts";
import { sinalNoGrupo } from "../processo.ts";
import { garantirWorktreeDemanda, garantirWorktreeRodada } from "../repositorio/worktree-demanda.ts";
import { fecharTicketDemanda, falharTicketDemanda } from "./fechamento_ticket.ts";
import { avisar, rodarPi } from "./gerente.ts";
import { ambientePi, confianca } from "./pi.ts";
import { argumentosPiDemanda } from "./pi_demanda.ts";
import { type ContextoDemanda, montarPromptDemanda } from "./prompt_demanda.ts";

type TicketRef = Pick<Sessao, "demanda_id" | "ticket_id">;

export interface OpcoesExecucaoDemanda {
  limiteMin: number;
  modo?: Exclude<ModoExecucao, "consulta">;
  /** Devolução ou reabertura do Auditor: o motivo vai ao prompt. */
  retomada?: ContextoDemanda["retomada"];
  /** Mensagem do Auditor ao retomar a sessão interativa: é o prompt da execução, sem remontar o contexto. */
  mensagem?: string;
  /** Fechamento do ticket depois do encerramento; injetável nos testes (padrão: `fecharTicketDemanda`). */
  fechar?: typeof fecharTicketDemanda;
}

/** Execuções com condutor vivo neste serviço, por id, com o grupo de processo do pi depois de lançado. */
const ativas = new Map<string, { pgid?: number; interrompida?: boolean }>();

/** Os condutores em curso: o `parar` do serviço os espera antes de fechar o banco. */
const condutores = new Set<Promise<void>>();
/** Desde o início do `parar`, o pi que sai é efeito da parada do serviço. */
let parando = false;

const INTERROMPIDA = "interrompida pelo Auditor";
const REINICIADO = "serviço reiniciado";

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
  const worktree = {
    nome: projeto.nome,
    repo: projeto.raiz_git,
    branchBase: projeto.branch_base,
    preparacao: projeto.preparacao.map((c) => c.comando),
  };
  return ticket.rodada_id === undefined
    ? garantirWorktreeDemanda(raiz, worktree, ag.demanda.id, log, () => varrerBase(banco, projeto.nome))
    : garantirWorktreeRodada(raiz, worktree, { demanda_id: ag.demanda.id, rodada_id: ticket.rodada_id }, log);
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

/** O único escritor do encerramento: fim, falha, erro e uso na mesma transação; não toca ticket, etapa nem gate. */
function encerrar(c: Encerravel, falha: string | undefined, log: string): void {
  const fim = new Date().toISOString();
  const usos = coletarUso(c, fim, log);
  comSessoesDoTicket(c.banco, c.ref, (estado) => ({
    ...estado,
    execucoes: encerrarExecucao(
      estado.execucoes.map((e) => (e.id === c.execucao.id && falha !== undefined ? { ...e, erro: falha } : e)),
      c.execucao.id,
      fim,
      falha !== undefined,
    ),
    usos: usos.reduce((acc, u) => registrarUso(acc, u), estado.usos),
  }));
}

async function conduzir(c: Conducao): Promise<void> {
  const raiz = raizDo(c.banco);
  const { execucao, sessao, projeto, opcoes } = c;
  const dir = join(raiz, "execucoes", `E-${execucao.id}`);
  const log = join(dir, "log");
  let falha: string | undefined;
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
    // Parada em curso durante a preparação: não lança um pi novo; a falha vira "serviço reiniciado" abaixo.
    if (parando) throw new Error(REINICIADO);
    anotar(log, `pi ${args.join(" ")}`);
    falha = await rodarPi({
      execucao: { id: execucao.id, sessaoPi: sessao.id, modo: sessao.modo },
      args,
      cwd: worktree,
      env: ambientePi(raiz, execucao.id, dir),
      log,
      prompt,
      limiteMin: opcoes.limiteMin,
      // Sem pid (o pi nem subiu) não há grupo a gravar; o `saiu` do pi relata o erro.
      aoLancar: (pgid) => {
        if (Number.isInteger(pgid)) gravarGrupo(c, pgid);
      },
    });
  } catch (error_) {
    falha = mensagem(error_);
    anotar(log, `preparação falhou: ${falha}`);
  }
  // Interrompida pelo Auditor: o pi saiu pelo SIGTERM, mas a causa verdadeira é a interrupção.
  if (ativas.get(execucao.id)?.interrompida) falha = INTERROMPIDA;
  // ponytail: o pi morto por sinal (código null) sem ser o Auditor é o cgroup do systemd, que pode matá-lo antes do
  // SIGTERM do serviço; um kill externo qualquer também vira "serviço reiniciado".
  else if (falha !== undefined && (parando || falha.includes("(código null)"))) falha = REINICIADO;
  ativas.delete(execucao.id);
  encerrar(c, falha, log);
  try {
    await (opcoes.fechar ?? fecharTicketDemanda)(c.banco, c.ref, { falha, execucao: execucao.id });
  } catch (error_) {
    anotar(log, `fechamento falhou: ${mensagem(error_)}`);
    try {
      falharTicketDemanda(c.banco, c.ref, `fechamento falhou: ${mensagem(error_)}`);
    } catch (erroFalha) {
      anotar(log, `falhar o ticket também falhou: ${mensagem(erroFalha)}`);
    }
  }
  // O último `estado` do SSE sai com o pi, antes do fim gravado e do fechamento: o chat precisa do cabeçalho novo.
  avisar(sessao.id, log);
}

/**
 * Inicia o ticket da demanda (sessão nova) ou o retoma (a mesma sessão e conversa, §7.3). Síncrona até gravar a execução
 * aberta: a recusa lança já. O pi roda em segundo plano; `fim` resolve com a execução encerrada e o uso gravado.
 */
export function iniciarExecucaoDemanda(
  banco: DatabaseSync,
  ref: TicketRef,
  opcoes: OpcoesExecucaoDemanda,
): { id: string; fim: Promise<void> } {
  const ag = carregarDemanda(banco, ref.demanda_id);
  const ticket = encontrado(
    ag.tickets.find((t) => t.ticket_id === ref.ticket_id),
    `o ticket ${ref.demanda_id}.T${String(ref.ticket_id)} não existe`,
    "confira o endereço do ticket",
  );
  const projeto = existe(
    configuracaoProjeto(banco, ag.demanda.projeto),
    `o projeto ${ag.demanda.projeto} não tem configuração do SDLC`,
    "configure o projeto",
  );
  const { modelo, effort } = resolverModeloEffort(
    ticket,
    projeto.etapas.find((e) => e.etapa === ticket.etapa),
  );
  const abrir = (sessao_id: string): ExecucaoSessao => ({
    id: randomUUID(),
    sessao_id,
    inicio: new Date().toISOString(),
    falha: false,
    ...(modelo.valor && { modelo_provedor: modelo.valor.provedor, modelo_nome: modelo.valor.nome }),
    ...(effort.valor && { effort: effort.valor }),
  });
  let sessao!: Sessao;
  let execucao!: ExecucaoSessao;
  comSessoesDoTicket(banco, ref, (estado) => {
    const existente = estado.sessoes[0];
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
  encerrarOrfa(banco, ref, execucao.id, INTERROMPIDA);
}

/** Execução aberta sem condutor: SIGKILL no grupo gravado, encerra com falha e falha o ticket em execução, sem tocar etapa nem gate. */
function encerrarOrfa(banco: DatabaseSync, ref: TicketRef, id: string, erro: string): void {
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
  encerrar({ banco, ref, sessao, execucao }, erro, log);
  falharTicketDemanda(banco, ref, erro);
  avisar(sessao.id, log);
}

/** Reinício do serviço (§4.2): toda execução aberta é de uma instância anterior e falha, sem avançar etapa nem gate. */
export function recuperarExecucoesDemanda(banco: DatabaseSync): void {
  for (const { id, demanda_id, ticket_id } of execucoesAbertasDaDemanda(banco)) {
    encerrarOrfa(banco, { demanda_id, ticket_id }, id, REINICIADO);
  }
  // Execução já encerrada e fechamento interrompido (coleta, ou entre o commit e a conclusão): sem execução aberta, o
  // ticket `em_execucao` não sairia mais (o `planejar` fica de fora: a retomada do despacho o assume; o gate do PR também). ponytail: falha em vez de repetir o fechamento; repetir fica para quando pedirem.
  const presos = banco
    .prepare(
      `SELECT demanda_id, ticket_id FROM ticket_demanda t WHERE status = 'em_execucao' AND (
         etapa IN ('implementar', 'resolver_conflito', 'encerrar_demanda', 'revisar_rodada', 'revisar_demanda')
         OR (etapa = 'encerrar_rodada' AND EXISTS (SELECT 1 FROM rodada r
           WHERE r.demanda_id = t.demanda_id AND r.rodada_id = t.rodada_id AND r.fase = 'encerramento')))`,
    )
    .all() as unknown as TicketRef[];
  for (const { demanda_id, ticket_id } of presos) falharTicketDemanda(banco, { demanda_id, ticket_id }, REINICIADO);
}
