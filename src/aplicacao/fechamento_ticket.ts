// Fechamento do ticket `implementar` e do `resolver_conflito` depois da resposta do agente (comparacao-sdlc-implementacao.md
// §6, D05, D06): verifica, submete as evidências, commita e conclui, ou devolve, ou falha. A devolução da D05 (até 2
// vezes, falha na 3ª) vale para as duas etapas; só a infraestrutura falha direto. O agente não submete nada.
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { FABRIQUINHA } from "../nucleo/ator.ts";
import type { AgregadoDemanda, TicketDemanda } from "../nucleo/agregado_demanda.ts";
import { concluirTicketImplementar } from "../nucleo/conclusao_ticket.ts";
import { espacoDoTicket } from "../nucleo/espaco_de_trabalho.ts";
import { evidenciasPendentes } from "../nucleo/evidencia.ts";
import { CATALOGO_ETAPAS } from "../nucleo/evidencia_etapa.ts";
import { Endereco } from "../nucleo/item_de_trabalho.ts";
import { concluirImplementacoesRodada } from "../nucleo/transicoes_rodada.ts";
import { concluirResolucaoConflito } from "../nucleo/transicoes_encerramento.ts";
import { devolverTicket, registrarFalhaTicket } from "../nucleo/transicoes_demanda.ts";
import { type FalhaDaTentativa, falhaPorServicoReiniciado, rotuloDaCausa } from "../nucleo/tentativa.ts";
import { coletarVerificacoes, type Falha, type RegistroDaVerificacao } from "./evidencias/verificacoes.ts";
import type { OpcoesSonar } from "../infra/verificacao/sonar.ts";
import { raizDo } from "../armazenamento/banco.ts";
import { carregarProjeto } from "../armazenamento/projetos.ts";
import { carregarDemanda, comDemanda } from "../armazenamento/demandas.ts";
import type { Commit } from "../armazenamento/commits.ts";
import { HooksDoCommit } from "../infra/verificacao/hooks_do_commit.ts";
import { submeterEvidencia } from "./evidencia/submeter.ts";
import { acharCommitTicketDemanda, commitarTicketDemanda } from "./commit_ticket_demanda.ts";

type Ref = Pick<TicketDemanda, "demanda_id" | "ticket_id">;

interface DepsFechamento {
  coletarVerificacoes?: typeof coletarVerificacoes;
  opcoes?: OpcoesSonar;
  /** Limite do `git commit`; o padrão é o dos comandos do projeto. */
  limiteCommitMs?: number;
  /** O serviço está parando: o que a coleta ou o commit devolverem é efeito da parada, não do ticket. */
  parada?: () => boolean;
}

/** Caracteres do fim dos logs que vão à instrução de devolução. */
const FIM_DO_LOG = 2000;

const contexto = () => ({ agora: new Date().toISOString() });

/** O ticket só se é `implementar` ou `resolver_conflito`; as demais etapas não são fechadas aqui. */
function ticketFechavel(ag: AgregadoDemanda, ticket_id: number): TicketDemanda | undefined {
  const t = ag.tickets.find((x) => x.ticket_id === ticket_id);
  return t?.etapa === "implementar" || t?.etapa === "resolver_conflito" ? t : undefined;
}

/** Falha o ticket em execução, de qualquer etapa, com a falha tipada, sem coletar, devolver nem gravar evidência; síncrona para os encerramentos órfãos. */
export function falharTicketDemanda(banco: DatabaseSync, ref: Ref, falha: FalhaDaTentativa): void {
  comDemanda(banco, ref.demanda_id, (ag) =>
    ag.tickets.find((t) => t.ticket_id === ref.ticket_id)?.estado === "em_execucao"
      ? registrarFalhaTicket(ag, { ticket_id: ref.ticket_id, falha }, contexto())
      : ag,
  );
}

/** Com a última implementação da rodada concluída, leva a rodada à revisão; de resto devolve o agregado como está. */
function concluirRodada(ag: AgregadoDemanda, { demanda_id, rodada_id }: TicketDemanda): AgregadoDemanda {
  const rodada = ag.rodadas.find((r) => r.rodada_id === rodada_id);
  const pendente = ag.tickets.some(
    (t) => t.rodada_id === rodada_id && t.etapa === "implementar" && t.estado !== "concluido",
  );
  return rodada?.estado === "implementar" && !pendente
    ? concluirImplementacoesRodada(ag, { demanda_id, rodada_id }, FABRIQUINHA, contexto())
    : ag;
}

/** Uma verificação que o Avaliador recusou, com o motivo dele. */
interface Recusa {
  verificacao: RegistroDaVerificacao;
  motivo: string;
}

/**
 * Submete a verificação como evidência da Fabriquinha, com os logs como anexos (copiados para uma pasta temporária,
 * que é de onde `submeterEvidencia` lê). Devolve a recusa, que não grava nada.
 */
function submeterVerificacao(
  banco: DatabaseSync,
  ref: Ref,
  worktree: string,
  verificacao: RegistroDaVerificacao,
): Recusa | undefined {
  const { tipo, dados, logs } = verificacao;
  const saida = realpathSync(mkdtempSync(join(tmpdir(), "fabriquinha-verificacao-")));
  try {
    // O Sonar devolve `logs: []`; o relatório (`dados`) vira o anexo, para a evidência nunca ficar sem log.
    const anexos = (logs.length ? logs : [{ nome: `${tipo}.log`, texto: JSON.stringify(dados, null, 2) }]).map(
      ({ nome, texto }) => {
        const caminho = join(saida, nome);
        writeFileSync(caminho, texto);
        return caminho;
      },
    );
    const avaliacao = submeterEvidencia(
      banco,
      { tipo, dono: Endereco.doTicket(ref.demanda_id, ref.ticket_id), produtor: FABRIQUINHA, dados, anexos },
      { origens: { worktree, saida, fora: "da pasta temporária das verificações", copie: saida } },
    );
    return avaliacao.resultado === "recusada" ? { verificacao, motivo: avaliacao.motivo } : undefined;
  } finally {
    rmSync(saida, { recursive: true, force: true });
  }
}

/** `- <tipo>: <motivo>` de cada verificação recusada e o fim dos logs dela. */
function relatorioDeReprovacao(recusas: Recusa[]): string {
  const linhas = recusas
    .map(({ verificacao: v, motivo }) => `- ${v.tipo}: ${v.falhas.map((f) => f.motivo).join("; ") || motivo}`)
    .join("\n");
  const log = recusas.flatMap(({ verificacao }) => verificacao.logs.map((l) => l.texto)).join("\n");
  return `${linhas}\n\n${log.slice(-FIM_DO_LOG)}`.trimEnd();
}

const devolverComRelatorio = (banco: DatabaseSync, ref: Ref, instrucao: string): void => {
  comDemanda(banco, ref.demanda_id, (a) =>
    devolverTicket(a, { ticket_id: ref.ticket_id, instrucao }, FABRIQUINHA, contexto()),
  );
};

/**
 * Fecha o ticket depois do encerramento da execução. Com `falha`, falha o ticket. Sem falha, se o commit do ticket já
 * existe (queda antes da conclusão) NÃO coleta de novo: a worktree limpa faria o Sonar aprovar sem analisar; usa as
 * evidências gravadas e só completa o registro do commit, a conclusão do ticket e a da rodada.
 */
export async function fecharTicketDemanda(
  banco: DatabaseSync,
  ref: Ref,
  { falha }: { falha?: FalhaDaTentativa },
  deps: DepsFechamento = {},
): Promise<void> {
  const ag = carregarDemanda(banco, ref.demanda_id);
  const ticket = ticketFechavel(ag, ref.ticket_id);
  if (ticket?.estado === "concluido" && ticket.etapa === "implementar") {
    comDemanda(banco, ref.demanda_id, (a) => concluirRodada(a, ticket));
    return;
  }
  if (ticket?.estado !== "em_execucao") return;
  if (falha !== undefined) {
    falharTicketDemanda(banco, ref, falha);
    return;
  }
  const falhar = (falhaDoFechamento: FalhaDaTentativa): void => {
    falharTicketDemanda(banco, ref, falhaDoFechamento);
  };
  const projeto = carregarProjeto(banco, ag.demanda.projeto);
  const { rodada_id } = ticket;
  const { pasta: worktree } = espacoDoTicket(ag, ticket, projeto, raizDo(banco));

  if (!(await acharCommitTicketDemanda(worktree, ref))) {
    const e2e = ag.rodadas.find((r) => r.rodada_id === rodada_id)?.e2e ?? false;
    const verificacoes = await (deps.coletarVerificacoes ?? coletarVerificacoes)({
      projeto,
      e2e,
      worktree,
      opcoes: deps.opcoes,
    });
    if (deps.parada?.()) {
      falhar(falhaPorServicoReiniciado);
      return;
    }
    if (verificacoes.some((v) => v.passou === undefined)) {
      const falhasDeInfraestrutura = verificacoes.flatMap((v) => v.falhas.filter((f) => f.classe === "infraestrutura"));
      const [{ causa }] = falhasDeInfraestrutura as [Extract<Falha, { classe: "infraestrutura" }>];
      falhar({
        tipo: "falha_infraestrutura",
        causa,
        motivo: `${rotuloDaCausa(causa)}:\n${falhasDeInfraestrutura.map((f) => `- ${f.motivo}`).join("\n")}`,
      });
      return;
    }
    const recusas = verificacoes.flatMap((v) => submeterVerificacao(banco, ref, worktree, v) ?? []);
    if (recusas.length > 0) {
      devolverComRelatorio(banco, ref, relatorioDeReprovacao(recusas));
      return;
    }
  }

  const pendentes = evidenciasPendentes(carregarDemanda(banco, ref.demanda_id), ticket, CATALOGO_ETAPAS);
  if (pendentes.length > 0) {
    devolverComRelatorio(banco, ref, `o ticket já tem commit, mas faltam as evidências: ${pendentes.join(", ")}`);
    return;
  }
  const commits: Commit[] = [];
  const hooks = new HooksDoCommit(async ({ worktree: raiz, limiteMs }) => {
    const commit = await commitarTicketDemanda(
      banco,
      ref,
      {
        worktree: raiz,
        tipo: ag.demanda.tipo === "funcionalidade" ? "feat" : "fix",
        titulo: ticket.titulo ?? ag.demanda.titulo,
        etapa: ticket.etapa,
      },
      limiteMs,
    );
    commits.push(commit);
  });
  let resultadoDosHooks;
  try {
    resultadoDosHooks = await hooks.executar({ worktree, limiteMs: deps.limiteCommitMs });
  } catch (erro) {
    if (!deps.parada?.()) throw erro;
    falhar(falhaPorServicoReiniciado);
    return;
  }
  if (deps.parada?.()) {
    falhar(falhaPorServicoReiniciado);
    return;
  }
  if (resultadoDosHooks.tipo === "reprovacao") {
    devolverComRelatorio(banco, ref, resultadoDosHooks.motivo);
    return;
  }
  if (resultadoDosHooks.tipo === "falha_infraestrutura") {
    falhar({ tipo: "falha_infraestrutura", causa: resultadoDosHooks.causa, motivo: resultadoDosHooks.motivo });
    return;
  }
  const [{ sha }] = commits as [Commit];
  comDemanda(banco, ref.demanda_id, (a) =>
    ticket.etapa === "implementar"
      ? concluirRodada(concluirTicketImplementar(a, { ticket_id: ref.ticket_id }, FABRIQUINHA, contexto()), ticket)
      : concluirResolucaoConflito(
          a,
          { demanda_id: ref.demanda_id, testes: true, fitness: true, sonar: true, sha },
          FABRIQUINHA,
          contexto(),
        ),
  );
}
