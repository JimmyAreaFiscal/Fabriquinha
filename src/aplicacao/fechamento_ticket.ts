// Fechamento do ticket `implementar` e do `resolver_conflito` depois da resposta do agente (comparacao-sdlc-implementacao.md
// §6, D05, D06): verifica, grava as evidências, commita e conclui, ou devolve, ou falha. A devolução da D05 (até 2
// vezes, falha na 3ª) vale para as duas etapas; só a infraestrutura falha direto. O agente não submete nada.
import type { DatabaseSync } from "node:sqlite";
import { FABRIQUINHA } from "../nucleo/ator.ts";
import type { AgregadoDemanda, TicketDemanda } from "../nucleo/agregado_demanda.ts";
import { concluirTicketImplementar } from "../nucleo/conclusao_ticket.ts";
import { espacoDoTicket } from "../nucleo/espaco_de_trabalho.ts";
import { type EntradaEvidenciaDemanda, submeterEvidenciaDemanda } from "../nucleo/evidencia_demanda.ts";
import { type EvidenciaEtapa, pendenciasDoTicket } from "../nucleo/evidencia_etapa.ts";
import { concluirImplementacoesRodada } from "../nucleo/transicoes_rodada.ts";
import { concluirResolucaoConflito } from "../nucleo/transicoes_encerramento.ts";
import { devolverTicket, registrarFalhaTicket } from "../nucleo/transicoes_demanda.ts";
import { type FalhaDaTentativa, falhaPorServicoReiniciado, rotuloDaCausa } from "../nucleo/tentativa.ts";
import { coletarVerificacoes, type Falha, type RegistroDaVerificacao } from "./evidencias/verificacoes.ts";
import type { OpcoesSonar } from "../infra/verificacao/sonar.ts";
import { MIME_TEXTO } from "../nucleo/schemas.ts";
import { raizDo } from "../armazenamento/banco.ts";
import { guardarBytes } from "../armazenamento/arquivos.ts";
import { carregarProjeto } from "../armazenamento/projetos.ts";
import { carregarDemanda, comDemanda } from "../armazenamento/demandas.ts";
import { gravarAnexos } from "../armazenamento/evidencia_demanda.ts";
import type { Commit } from "../armazenamento/commits.ts";
import { HooksDoCommit } from "../infra/verificacao/hooks_do_commit.ts";
import { ambienteDoServico } from "./espaco/ambiente_do_servico.ts";
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

/** As evidências do ticket como o domínio as lê; `aprovada` vem dos `dados`, onde o fechamento a grava. */
const evidenciasDoTicket = (ag: AgregadoDemanda, ticket_id: number): EvidenciaEtapa[] =>
  ag.evidencias
    .filter((e) => e.ticket_id === ticket_id)
    .map((e) => ({ ...e, produtor: "fabriquinha", aprovada: e.dados.aprovada === true }));

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

/** Grava as três evidências do ticket com os logs de cada uma como anexos, numa transação só. */
function gravarEvidencias(banco: DatabaseSync, ref: Ref, verificacoes: RegistroDaVerificacao[]): void {
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
            FABRIQUINHA,
            contexto().agora,
          ),
        ag,
      ),
    () => {
      for (const { v, anexos } of guardadas)
        // Só demanda e ticket: o `ref` pode ser o ticket inteiro (com `rodada_id`), que não é a chave da evidência.
        gravarAnexos(banco, { demanda_id: ref.demanda_id, ticket_id: ref.ticket_id, tipo: v.tipo }, anexos);
    },
  );
}

/** `- <tipo>: <motivo>` de cada verificação reprovada e o fim dos logs dela. */
function relatorioDeReprovacao(reprovadas: RegistroDaVerificacao[]): string {
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

  if (!(await acharCommitTicketDemanda(ambienteDoServico(), worktree, ref))) {
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
    if (verificacoes.some((v) => v.aprovada === undefined)) {
      const falhasDeInfraestrutura = verificacoes.flatMap((v) => v.falhas.filter((f) => f.classe === "infraestrutura"));
      const [{ causa }] = falhasDeInfraestrutura as [Extract<Falha, { classe: "infraestrutura" }>];
      falhar({
        tipo: "falha_infraestrutura",
        causa,
        motivo: `${rotuloDaCausa(causa)}:\n${falhasDeInfraestrutura.map((f) => `- ${f.motivo}`).join("\n")}`,
      });
      return;
    }
    gravarEvidencias(banco, ref, verificacoes);
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
    falhar({
      tipo: "falha_infraestrutura",
      causa: "comando_ausente",
      motivo: `${rotuloDaCausa("comando_ausente")}: o ticket já tem commit, mas as evidências de verificação não estão aprovadas (ausentes: ${ausentes.join(", ") || "nenhuma"}; reprovadas: ${reprovadas.join(", ") || "nenhuma"})`,
    });
    return;
  }
  const commits: Commit[] = [];
  const hooks = new HooksDoCommit(async ({ worktree: raiz, limiteMs }) => {
    const commit = await commitarTicketDemanda(
      banco,
      ref,
      {
        ambiente: ambienteDoServico(),
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
    const instrucao = resultadoDosHooks.motivo;
    comDemanda(banco, ref.demanda_id, (a) =>
      devolverTicket(a, { ticket_id: ref.ticket_id, instrucao }, FABRIQUINHA, contexto()),
    );
    return;
  }
  if (resultadoDosHooks.tipo === "falha_infraestrutura") {
    falhar({ tipo: "falha_infraestrutura", causa: resultadoDosHooks.causa, motivo: resultadoDosHooks.motivo });
    return;
  }
  const [{ sha }] = commits as [Commit];
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
          { demanda_id: ref.demanda_id, testes: true, fitness: true, sonar: true, sha },
          FABRIQUINHA,
          contexto(),
        ),
  );
}
