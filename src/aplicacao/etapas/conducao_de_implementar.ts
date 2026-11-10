// A condução do `implementar` (comparacao-sdlc-implementacao.md §6, D05, D06): depois do agente, a Fabriquinha verifica,
// submete as evidências, commita com os hooks e conclui, ou devolve (até 2 vezes, falha na 3ª), ou falha. O agente não
// submete nada; só a infraestrutura falha direto.
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { FABRIQUINHA } from "../../nucleo/ator.ts";
import type { AgregadoDemanda, TicketDemanda } from "../../nucleo/agregado_demanda.ts";
import { concluirTicketImplementar } from "../../nucleo/conclusao_ticket.ts";
import { espacoDoTicket } from "../../nucleo/espaco_de_trabalho.ts";
import { type DefinicaoDaEtapa, CATALOGO_DE_ETAPAS } from "../../nucleo/etapa.ts";
import { evidenciasPendentes } from "../../nucleo/evidencia.ts";
import { CATALOGO_ETAPAS } from "../../nucleo/evidencia_etapa.ts";
import { Endereco } from "../../nucleo/item_de_trabalho.ts";
import type { Projeto } from "../../nucleo/projeto.ts";
import { falhaPorServicoReiniciado, rotuloDaCausa } from "../../nucleo/tentativa.ts";
import { concluirImplementacoesRodada } from "../../nucleo/transicoes_rodada.ts";
import { raizDo } from "../../armazenamento/banco.ts";
import { carregarDemanda, comDemanda } from "../../armazenamento/demandas.ts";
import { carregarProjeto } from "../../armazenamento/projetos.ts";
import { HooksDoCommit } from "../../infra/verificacao/hooks_do_commit.ts";
import type { OpcoesSonar } from "../../infra/verificacao/sonar.ts";
import { montarVerificacoesDaEtapa } from "../../infra/verificacao/verificacao.ts";
import { ambienteDoServico } from "../espaco/ambiente_do_servico.ts";
import { acharCommitTicketDemanda, commitarTicketDemanda } from "../commit_ticket_demanda.ts";
import { submeterEvidencia } from "../evidencia/submeter.ts";
import { coletarVerificacoes, type Falha, type RegistroDaVerificacao } from "../evidencias/verificacoes.ts";
import { ConducaoAgentica, type DepsDaConducao, type ResultadoDaConferencia } from "./conducao_de_etapa.ts";

/** O que os testes injetam: a coleta das verificações e o limite do commit. */
export interface OpcoesDaImplementacao {
  coletarVerificacoes?: typeof coletarVerificacoes;
  opcoesSonar?: OpcoesSonar;
  /** Limite do `git commit`; o padrão é o dos comandos do projeto. */
  limiteCommitMs?: number;
}

/** Caracteres do fim dos logs que vão à instrução de devolução. */
const FIM_DO_LOG = 2000;

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
  ticket: TicketDemanda,
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
      {
        tipo,
        dono: Endereco.doTicket(ticket.demanda_id, ticket.ticket_id),
        produtor: FABRIQUINHA,
        dados,
        anexos,
      },
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

export class ConducaoDeImplementar extends ConducaoAgentica {
  private readonly opcoes: OpcoesDaImplementacao;

  constructor(
    deps: DepsDaConducao,
    opcoes: OpcoesDaImplementacao = {},
    definicao: DefinicaoDaEtapa = CATALOGO_DE_ETAPAS.implementar,
  ) {
    super(definicao, deps);
    this.opcoes = opcoes;
  }

  /**
   * Com o commit do ticket já feito (queda antes da conclusão) NÃO coleta de novo: a worktree limpa faria o Sonar
   * aprovar sem analisar; usa as evidências gravadas e só completa o registro do commit.
   */
  protected override async conferirResultado(endereco: Endereco): Promise<ResultadoDaConferencia> {
    const { banco } = this.deps;
    const ticket = this.ticketDe(endereco);
    const ag = carregarDemanda(banco, ticket.demanda_id);
    const projeto = carregarProjeto(banco, ag.demanda.projeto);
    const { pasta: worktree } = espacoDoTicket(ag, ticket, projeto, raizDo(banco));
    if (!(await acharCommitTicketDemanda(ambienteDoServico(), worktree, ticket))) {
      const naoPassou = await this.verificarEGravarEvidencias(ticket, ag, projeto, worktree);
      if (naoPassou) return naoPassou;
    }
    const pendentes = evidenciasPendentes(carregarDemanda(banco, ticket.demanda_id), ticket, CATALOGO_ETAPAS);
    if (pendentes.length > 0) {
      return {
        tipo: "reprovacao",
        motivo: `o ticket já tem commit, mas faltam as evidências: ${pendentes.join(", ")}`,
      };
    }
    return this.commitarComHooks(ticket, ag, worktree);
  }

  /** Coleta as verificações e grava como evidência as que o Avaliador aceita; devolve o que impede de seguir ao commit. */
  private async verificarEGravarEvidencias(
    ticket: TicketDemanda,
    ag: AgregadoDemanda,
    projeto: Projeto,
    worktree: string,
  ): Promise<ResultadoDaConferencia | undefined> {
    const { banco, condutor } = this.deps;
    const e2e = ag.rodadas.find((r) => r.rodada_id === ticket.rodada_id)?.e2e ?? false;
    const verificacoes = await (this.opcoes.coletarVerificacoes ?? coletarVerificacoes)({
      ambiente: ambienteDoServico(),
      projeto,
      e2e,
      worktree,
      opcoes: this.opcoes.opcoesSonar,
    });
    if (condutor.emParada()) return falhaPorServicoReiniciado;
    if (verificacoes.some((v) => v.passou === undefined)) {
      const falhasDeInfraestrutura = verificacoes.flatMap((v) => v.falhas.filter((f) => f.classe === "infraestrutura"));
      const [{ causa }] = falhasDeInfraestrutura as [Extract<Falha, { classe: "infraestrutura" }>];
      return {
        tipo: "falha_infraestrutura",
        causa,
        motivo: `${rotuloDaCausa(causa)}:\n${falhasDeInfraestrutura.map((f) => `- ${f.motivo}`).join("\n")}`,
      };
    }
    const recusas = verificacoes.flatMap((v) => submeterVerificacao(banco, ticket, worktree, v) ?? []);
    return recusas.length > 0 ? { tipo: "reprovacao", motivo: relatorioDeReprovacao(recusas) } : undefined;
  }

  /** O commit do ticket passa pelos hooks do projeto; o hook que reprova devolve o ticket. */
  private async commitarComHooks(
    ticket: TicketDemanda,
    ag: AgregadoDemanda,
    worktree: string,
  ): Promise<ResultadoDaConferencia> {
    const { banco, condutor } = this.deps;
    const { hooks_do_commit: hooks } = montarVerificacoesDaEtapa(ticket.etapa, {
      hooks_do_commit: () =>
        new HooksDoCommit(async ({ worktree: raiz, limiteMs }) => {
          await commitarTicketDemanda(
            banco,
            ticket,
            {
              ambiente: ambienteDoServico(),
              worktree: raiz,
              tipo: ag.demanda.tipo === "funcionalidade" ? "feat" : "fix",
              titulo: ticket.titulo ?? ag.demanda.titulo,
              etapa: ticket.etapa,
            },
            limiteMs,
          );
        }),
    });
    let resultadoDosHooks;
    try {
      resultadoDosHooks = await hooks.executar({
        ambiente: ambienteDoServico(),
        worktree,
        limiteMs: this.opcoes.limiteCommitMs,
      });
    } catch (erro) {
      if (!condutor.emParada()) throw erro;
      return falhaPorServicoReiniciado;
    }
    if (condutor.emParada()) return falhaPorServicoReiniciado;
    if (resultadoDosHooks.tipo === "reprovacao") return { tipo: "reprovacao", motivo: resultadoDosHooks.motivo };
    if (resultadoDosHooks.tipo === "falha_infraestrutura") {
      return { tipo: "falha_infraestrutura", causa: resultadoDosHooks.causa, motivo: resultadoDosHooks.motivo };
    }
    return { tipo: "sucesso" };
  }

  /** Conclui o ticket e, com a última implementação da rodada concluída, leva a rodada à revisão. */
  protected override aoConcluir(endereco: Endereco): Promise<void> {
    const { banco, relogio } = this.deps;
    const ticket = this.ticketDe(endereco);
    comDemanda(banco, ticket.demanda_id, (ag) =>
      this.concluirRodada(
        concluirTicketImplementar(ag, { ticket_id: ticket.ticket_id }, FABRIQUINHA, { agora: relogio.agora() }),
        ticket,
      ),
    );
    return Promise.resolve();
  }

  private concluirRodada(ag: AgregadoDemanda, { demanda_id, rodada_id }: TicketDemanda): AgregadoDemanda {
    const rodada = ag.rodadas.find((r) => r.rodada_id === rodada_id);
    const pendente = ag.tickets.some(
      (t) => t.rodada_id === rodada_id && t.etapa === "implementar" && t.estado !== "concluido",
    );
    return rodada?.estado === "implementar" && !pendente
      ? concluirImplementacoesRodada(ag, { demanda_id, rodada_id }, FABRIQUINHA, { agora: this.deps.relogio.agora() })
      : ag;
  }
}
