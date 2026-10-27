// Fechamento do ticket `implementar` e do `resolver_conflito` depois da resposta do agente (comparacao-sdlc-implementacao.md
// §6, D05, D06): verifica, grava as evidências, commita e conclui, ou devolve, ou falha. A devolução da D05 (até 2
// vezes, falha na 3ª) vale para as duas etapas; só a infraestrutura falha direto. O agente não submete nada.
import type { DatabaseSync } from "node:sqlite";
import { FABRIQUINHA } from "../dominio/agregado.ts";
import type { AgregadoDemanda, TicketDemanda } from "../dominio/agregado_demanda.ts";
import { concluirTicketImplementar } from "../dominio/conclusao_ticket.ts";
import { ErroDeReprovacao, existe } from "../dominio/erros.ts";
import { type EntradaEvidenciaDemanda, submeterEvidenciaDemanda } from "../dominio/evidencia_demanda.ts";
import { type EvidenciaEtapa, pendenciasDoTicket } from "../dominio/evidencia_etapa.ts";
import { concluirImplementacoesRodada } from "../dominio/transicoes_rodada.ts";
import { concluirResolucaoConflito } from "../dominio/transicoes_encerramento.ts";
import { devolverTicket, registrarFalhaTicket } from "../dominio/transicoes_demanda.ts";
import { coletarVerificacoes, type Verificacao } from "../evidencias/verificacoes.ts";
import type { OpcoesSonar } from "../evidencias/sonar.ts";
import { MIME_TEXTO } from "../evidencias/schemas.ts";
import { raizDo } from "../persistencia/banco.ts";
import { guardarBytes } from "../persistencia/arquivos.ts";
import { configuracaoProjeto } from "../persistencia/configuracao_projeto.ts";
import { carregarDemanda, comDemanda } from "../persistencia/demandas.ts";
import { gravarAnexos } from "../persistencia/evidencia_demanda.ts";
import { caminhoDaWorktreeDemanda, caminhoDaWorktreeRodada } from "../repositorio/worktree-demanda.ts";
import { acharCommitTicketDemanda, commitarTicketDemanda } from "./commit_ticket_demanda.ts";

type Ref = Pick<TicketDemanda, "demanda_id" | "ticket_id">;

export interface DepsFechamento {
  coletarVerificacoes?: typeof coletarVerificacoes;
  opcoes?: OpcoesSonar;
}

/** Caracteres do fim dos logs que vão à instrução de devolução. */
const FIM_DO_LOG = 2000;

const contexto = () => ({ agora: new Date().toISOString() });

/** O ticket só se é `implementar` ou `resolver_conflito`; as demais etapas não são fechadas aqui. */
function ticketFechavel(ag: AgregadoDemanda, ticket_id: number): TicketDemanda | undefined {
  const t = ag.tickets.find((x) => x.ticket_id === ticket_id);
  return t?.etapa === "implementar" || t?.etapa === "resolver_conflito" ? t : undefined;
}

/** Falha o ticket em execução com o motivo, sem coletar, devolver nem gravar evidência; síncrona para os encerramentos órfãos. */
export function falharTicketDemanda(banco: DatabaseSync, ref: Ref, motivo: string): void {
  comDemanda(banco, ref.demanda_id, (ag) =>
    ticketFechavel(ag, ref.ticket_id)?.status === "em_execucao"
      ? registrarFalhaTicket(ag, { ticket_id: ref.ticket_id, motivo }, contexto())
      : ag,
  );
}

/** As evidências do ticket como o domínio as lê; `aprovada` vem dos `dados`, onde o fechamento a grava. */
const evidenciasDoTicket = (ag: AgregadoDemanda, ticket_id: number): EvidenciaEtapa[] =>
  ag.evidencias
    .filter((e) => e.ticket_id === ticket_id)
    .map((e) => ({ ...e, produtor: "fabriquinha", aprovada: e.dados.aprovada === true }));

/** Com a última implementação da rodada concluída, leva a rodada à revisão; de resto devolve o agregado como está. */
function concluirRodada(ag: AgregadoDemanda, { demanda_id, rodada_id }: TicketDemanda): AgregadoDemanda {
  const rodada = ag.rodadas.find((r) => r.rodada_id === rodada_id);
  const pendente = ag.tickets.some(
    (t) => t.rodada_id === rodada_id && t.etapa === "implementar" && t.status !== "concluido",
  );
  return rodada?.fase === "desenvolvimento" && !pendente
    ? concluirImplementacoesRodada(ag, { demanda_id, rodada_id }, FABRIQUINHA, contexto())
    : ag;
}

/** Grava as três evidências do ticket com os logs de cada uma como anexos, numa transação só. */
function gravarEvidencias(banco: DatabaseSync, ref: Ref, verificacoes: Verificacao[], execucao: string): void {
  const autor = { ferramenta: "fabriquinha", sessao: execucao };
  const guardadas = verificacoes.map((v) => ({
    v,
    // O Sonar devolve `logs: []`; o relatório (`dados`) vira o anexo, para a evidência nunca ficar sem log.
    anexos: (v.logs.length ? v.logs : [{ nome: `${v.tipo}.log`, texto: JSON.stringify(v.dados, null, 2) }]).map(
      (l) => ({ caminho: l.nome, mime: MIME_TEXTO, ...guardarBytes(banco, Buffer.from(l.texto)) }),
    ),
  }));
  comDemanda(
    banco,
    ref.demanda_id,
    (ag) =>
      guardadas.reduce(
        (a, { v }) =>
          submeterEvidenciaDemanda(
            a,
            {
              tipo: v.tipo,
              ticket_id: ref.ticket_id,
              // ponytail: a evidência da demanda não tem coluna `aprovada`; ela vai nos `dados`.
              dados: { ...v.dados, aprovada: v.aprovada } as EntradaEvidenciaDemanda["dados"],
            },
            autor,
            contexto().agora,
          ),
        ag,
      ),
    () => {
      for (const { v, anexos } of guardadas) gravarAnexos(banco, { ...ref, tipo: v.tipo }, anexos);
    },
  );
}

/** `- <tipo>: <motivo>` de cada verificação reprovada e o fim dos logs dela. */
function relatorioDeReprovacao(reprovadas: Verificacao[]): string {
  const linhas = reprovadas.map((v) => `- ${v.tipo}: ${v.falhas.map((f) => f.motivo).join("; ")}`).join("\n");
  const log = reprovadas.flatMap((v) => v.logs.map((l) => l.texto)).join("\n");
  return `${linhas}\n\n${log.slice(-FIM_DO_LOG)}`.trimEnd();
}

/**
 * Fecha o ticket depois do encerramento da execução. Com `falha`, falha o ticket. Sem falha, se o commit do ticket já
 * existe (queda antes da conclusão) NÃO coleta de novo: a worktree limpa faria o Sonar aprovar sem analisar; usa as
 * evidências gravadas e só completa o registro do commit, a conclusão do ticket e a da rodada.
 */
export async function fecharTicketDemanda(
  banco: DatabaseSync,
  ref: Ref,
  { falha, execucao }: { falha?: string; execucao: string },
  deps: DepsFechamento = {},
): Promise<void> {
  const ag = carregarDemanda(banco, ref.demanda_id);
  const ticket = ticketFechavel(ag, ref.ticket_id);
  if (ticket?.status === "concluido" && ticket.etapa === "implementar") {
    comDemanda(banco, ref.demanda_id, (a) => concluirRodada(a, ticket));
    return;
  }
  if (ticket?.status !== "em_execucao") return;
  if (falha !== undefined) {
    falharTicketDemanda(banco, ref, falha);
    return;
  }
  const falhar = (motivo: string): void => {
    falharTicketDemanda(banco, ref, motivo);
  };
  const projeto = existe(
    configuracaoProjeto(banco, ag.demanda.projeto),
    `o projeto ${ag.demanda.projeto} não tem configuração do SDLC`,
    "configure o projeto",
  );
  const { rodada_id } = ticket;
  const worktree =
    rodada_id === undefined
      ? caminhoDaWorktreeDemanda(raizDo(banco), projeto.nome, ref.demanda_id)
      : caminhoDaWorktreeRodada(raizDo(banco), projeto.nome, { demanda_id: ref.demanda_id, rodada_id });

  if (!(await acharCommitTicketDemanda(worktree, ref))) {
    const e2e = ag.rodadas.find((r) => r.rodada_id === rodada_id)?.e2e ?? false;
    const verificacoes = await (deps.coletarVerificacoes ?? coletarVerificacoes)({
      projeto,
      e2e,
      worktree,
      opcoes: deps.opcoes,
    });
    if (verificacoes.some((v) => v.aprovada === undefined)) {
      const motivos = verificacoes.flatMap((v) => v.falhas.filter((f) => f.classe === "infraestrutura"));
      falhar(`falha de infraestrutura:\n${motivos.map((f) => `- ${f.motivo}`).join("\n")}`);
      return;
    }
    gravarEvidencias(banco, ref, verificacoes, execucao);
    const reprovadas = verificacoes.filter((v) => !v.aprovada);
    if (reprovadas.length > 0) {
      const relatorio = relatorioDeReprovacao(reprovadas);
      comDemanda(banco, ref.demanda_id, (a) =>
        devolverTicket(a, { ticket_id: ref.ticket_id, instrucao: relatorio }, FABRIQUINHA, contexto()),
      );
      return;
    }
  }

  const { ausentes, reprovadas } = pendenciasDoTicket(
    { ...ref, etapa: ticket.etapa },
    evidenciasDoTicket(carregarDemanda(banco, ref.demanda_id), ref.ticket_id),
  );
  if (ausentes.length > 0 || reprovadas.length > 0) {
    falhar(
      `falha de infraestrutura: o ticket já tem commit, mas as evidências de verificação não estão aprovadas (ausentes: ${ausentes.join(", ") || "nenhuma"}; reprovadas: ${reprovadas.join(", ") || "nenhuma"})`,
    );
    return;
  }
  let commit;
  try {
    commit = await commitarTicketDemanda(banco, ref, {
      worktree,
      tipo: ag.demanda.tipo === "funcionalidade" ? "feat" : "fix",
      titulo: ticket.titulo ?? ag.demanda.titulo,
    });
  } catch (erro) {
    // ponytail: o hook que reprova o commit falha o ticket; devolver ao agente fica para quando pedirem.
    if (!(erro instanceof ErroDeReprovacao)) throw erro;
    falhar(erro.message);
    return;
  }
  comDemanda(banco, ref.demanda_id, (a) =>
    ticket.etapa === "implementar"
      ? concluirRodada(
          concluirTicketImplementar(
            a,
            { ticket_id: ref.ticket_id },
            FABRIQUINHA,
            contexto(),
            evidenciasDoTicket(a, ref.ticket_id),
          ),
          ticket,
        )
      : concluirResolucaoConflito(
          a,
          { demanda_id: ref.demanda_id, testes: true, fitness: true, sonar: true, sha: commit.sha },
          FABRIQUINHA,
          contexto(),
        ),
  );
}
