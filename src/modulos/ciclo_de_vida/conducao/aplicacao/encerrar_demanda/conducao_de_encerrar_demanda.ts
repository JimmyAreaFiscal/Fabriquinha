// A condução do `encerrar_demanda` (comparacao-sdlc-implementacao.md §§5 e 6), sem agente, gate nem nota: PR final da
// branch da demanda para a base do projeto (D02), conflito (D06), check final, espera do merge humano na plataforma
// (a integração final depende do humano), integração confirmada com SHA, limpeza por posse e evidências. Cada efeito
// externo é seguido da transição do domínio, que decide se ele se repete (progresso recuperável).
import {
  FABRIQUINHA,
  DEFINICAO_DO_ENCERRAR_DEMANDA,
  type FalhaDaTentativa,
  falhaDoErro,
  falhaQueExigeOAuditor,
} from "../../../etapas/publico.ts";
import { type AgregadoDemanda, prDaDemanda } from "../../../../sdlc/nucleo/demanda/agregado_demanda.ts";
import { existe } from "../../../../../shared/nucleo/erros.ts";
import {
  espacoDaDemanda,
  pendenciasDeLimpeza,
  sobrasDaDemanda,
  lerPR,
  type OpcoesVerificacao,
  ambienteDoEspaco,
  cicloDoEspaco,
} from "../../../../repositorio/publico.ts";
import type { Endereco } from "../../../etapas/publico.ts";
import {
  concluirEncerramentoDaDemanda,
  registrarConflitoDoEncerramento,
  registrarFalhaDoEncerramento,
  registrarFalhaDoTicket,
  registrarIntegracaoFinal,
  registrarTentativaDoEncerramento,
  solicitarIntegracaoFinal,
} from "../../../processo/aplicacao/transicoes_pedidas.ts";
import { raizDo } from "../../../../../shared/armazenamento/banco.ts";
import { carregarDemanda } from "../../../../sdlc/armazenamento/demandas.ts";
import type { Projeto } from "../../../../projeto/nucleo/projeto.ts";
import { carregarProjeto } from "../../../../projeto/armazenamento/projetos.ts";
import { carregarSessoesDoContexto, lerUsoDeclarado } from "../../../../sessoes/publico.ts";
import { logDaOperacao } from "../../../../../shared/infra/registro.ts";
import { ConferenciaDoPR, montarVerificacoesDaEtapa } from "../../../verificacoes/publico.ts";
import { montarArvorePRs, montarDemonstracaoLimpeza } from "./encerramento_demanda.ts";
import { submeterEvidencia } from "../../../../sdlc/aplicacao/evidencias/submeter.ts";
import { publicarPRFinal } from "./publicacao_do_pr_final.ts";
import { varrerCommitsHumanos } from "../../../../projeto/aplicacao/varredura_de_commits_humanos.ts";
import {
  ConducaoDeterministica,
  type PassoDaEtapa,
  type ResultadoDoPasso,
} from "../conducao_de_etapa/conducao_de_etapa.ts";
import type { DepsDaConducao } from "../conducao_de_etapa/conducao_de_etapa.ts";

/** Grava o encerramento do processo (`gravarEncerramentoDoProcesso`) junto da conclusão do pedido `demandaId`. */
type ConcluirDesenvolvimento = (demandaId: string, gravarEncerramentoDoProcesso: () => void) => void;

export interface OpcoesDoEncerramentoDaDemanda {
  /** Espera da verificação do PR (limite, intervalo e carência); o padrão é o de produção. */
  verificacao?: OpcoesVerificacao;
  /**
   * O fluxo da conclusão, que a composição liga a Demandas; sem ele (nos testes da condução), só o processo é gravado.
   * provisório: remover no ticket 22, quando a Condução pedir a conclusão ao Processo e a composição sempre o ligar.
   */
  concluirDesenvolvimento?: ConcluirDesenvolvimento;
}

const soOEncerramentoDoProcesso: ConcluirDesenvolvimento = (_demandaId, gravarEncerramentoDoProcesso) => {
  gravarEncerramentoDoProcesso();
};

/** As evidências do encerramento não têm anexo: nenhuma origem é lida. */
const SEM_ORIGEM_DE_ANEXO = { worktree: "", saida: "", fora: "", copie: "" };

type NomeDoPasso = "check_final" | "integracao" | "limpeza";

/**
 * Conduz o `encerrar_demanda` aberto de uma demanda em `encerrar_demanda`, reservando-o; a retomada começa pelo passo que
 * o progresso gravado mostra pendente:
 * - `check_final`: publica (ou reaproveita) o PR final e registra a tentativa; conflito com a base cria o
 *   `resolver_conflito` e devolve o ticket a `aberto`; check falho ou erro da hospedagem falha o ticket;
 * - `integracao`: espera o humano aprovar e integrar o PR na plataforma: o ticket volta a `aberto` e cada ciclo do
 *   agendador relê o PR; PR fechado sem merge falha o ticket; mergeado, grava o SHA;
 * - `limpeza`: sobras falham o ticket e só elas se repetem; sem sobras, grava as evidências e conclui a demanda.
 */
export class ConducaoDeEncerrarDemanda extends ConducaoDeterministica {
  private readonly opcoes: OpcoesDoEncerramentoDaDemanda;

  protected readonly passos: PassoDaEtapa[] = [
    {
      nome: "check_final",
      pendente: (ticket) => {
        const encerramento = this.agregadoDe(ticket).encerramento;
        return encerramento?.integracao === undefined && !encerramento?.aguardando_merge_humano;
      },
      executar: (ticket) => this.conferirPRFinal(ticket),
    },
    {
      nome: "integracao",
      pendente: (ticket) => this.agregadoDe(ticket).encerramento?.integracao === undefined,
      executar: (ticket) => this.aguardarMergeHumano(ticket),
    },
    { nome: "limpeza", pendente: () => true, executar: (ticket) => this.limpar(ticket) },
  ];

  constructor(deps: DepsDaConducao, opcoes: OpcoesDoEncerramentoDaDemanda = {}) {
    super(DEFINICAO_DO_ENCERRAR_DEMANDA, deps);
    this.opcoes = opcoes;
  }

  /** O ciclo do Espaço da demanda, no Ambiente do Espaço, com o log do encerramento. */
  private cicloDoEspacoDaDemanda(projeto: Projeto, demanda_id: string): ReturnType<typeof cicloDoEspaco> {
    const raiz = raizDo(this.deps.banco);
    const log = logDaOperacao(raiz, `encerramento-${demanda_id}`);
    const espaco = espacoDaDemanda(projeto, demanda_id, raiz);
    return cicloDoEspaco(espaco, projeto, { raiz, log }, ambienteDoEspaco(espaco));
  }

  private async conferirPRFinal(endereco: Endereco): Promise<ResultadoDoPasso> {
    const { banco, relogio } = this.deps;
    const { demanda_id } = endereco;
    const ag = this.agregadoDe(endereco);
    const projeto = carregarProjeto(banco, ag.demanda.projeto);
    const raiz = raizDo(banco);
    const log = logDaOperacao(raiz, `encerramento-${demanda_id}`);
    // O erro até a tentativa registrada sobe e a base falha o ticket.
    const ciclo = this.cicloDoEspacoDaDemanda(projeto, demanda_id);
    await varrerCommitsHumanos(banco, projeto.nome).catch(ciclo.anotarFalhaDaVarredura);
    const publicado = await publicarPRFinal(banco, ag, projeto, projeto.branch_base, raiz);
    registrarTentativaDoEncerramento(
      banco,
      demanda_id,
      {
        demanda_id,
        base: projeto.branch_base,
        pr: { numero: Number(publicado.id), url: publicado.url },
        sha: publicado.head,
      },
      FABRIQUINHA,
      relogio,
    );

    try {
      const { conferencia_do_pr: conferenciaDoPR } = montarVerificacoesDaEtapa("encerrar_demanda", {
        conferencia_do_pr: () => new ConferenciaDoPR(projeto, publicado.id, log, this.opcoes.verificacao),
      });
      const problemas = await conferenciaDoPR.conferir();
      if (problemas.conflito) {
        registrarConflitoDoEncerramento(banco, demanda_id, { demanda_id }, FABRIQUINHA, relogio);
        return "parar";
      }
      if (problemas.checksFalhos.length > 0) {
        const falhos = problemas.checksFalhos.map((c) => [c.nome, c.url].filter(Boolean).join(" "));
        this.falharPasso(
          endereco,
          "check_final",
          falhaQueExigeOAuditor(`check final falho no PR ${publicado.url}: ${falhos.join(", ")}`),
        );
        return "parar";
      }
    } catch (erro) {
      this.falharPasso(endereco, "check_final", falhaDoErro(erro));
      return "parar";
    }

    solicitarIntegracaoFinal(banco, demanda_id, { demanda_id }, FABRIQUINHA, relogio);
    return "seguir";
  }

  // A Fabriquinha não integra o PR final: a plataforma pode exigir a aprovação do humano (Azure Repos) e o merge é dele.
  private async aguardarMergeHumano(endereco: Endereco): Promise<ResultadoDoPasso> {
    const { banco, relogio } = this.deps;
    const { demanda_id } = endereco;
    const ag = this.agregadoDe(endereco);
    const projeto = carregarProjeto(banco, ag.demanda.projeto);
    const pr = existe(prDaDemanda(ag), `a demanda ${demanda_id} não tem PR final`, "registre a tentativa antes");
    const devolverParaEspera = () => {
      solicitarIntegracaoFinal(banco, demanda_id, { demanda_id }, FABRIQUINHA, relogio);
    };
    let leitura;
    try {
      leitura = await lerPR(projeto, String(pr.numero), relogio);
    } catch (erro) {
      devolverParaEspera(); // a leitura que falha não é decisão do humano: o próximo ciclo relê
      throw erro;
    }
    if (leitura.estado === "fechado") {
      this.falharPasso(
        endereco,
        "integracao",
        falhaQueExigeOAuditor(`o PR final ${pr.url} foi fechado sem merge: reabra-o e integre-o na plataforma`),
      );
      return "parar";
    }
    if (leitura.estado !== "mergeado") {
      devolverParaEspera();
      return "parar";
    }
    const sha = existe(
      leitura.mergeSha,
      `a hospedagem não informou o merge do PR ${pr.url}`,
      "confira o PR na plataforma",
    );
    const ambiente = this.cicloDoEspacoDaDemanda(projeto, demanda_id).ambiente;
    const pendentes = await pendenciasDeLimpeza(ambiente, raizDo(banco), projeto, ag);
    registrarIntegracaoFinal(
      banco,
      demanda_id,
      { demanda_id, confirmada: true, sha, limpeza_pendente: pendentes },
      FABRIQUINHA,
      relogio,
    );
    return "seguir";
  }

  private async limpar(endereco: Endereco): Promise<ResultadoDoPasso> {
    const { banco, relogio } = this.deps;
    const { demanda_id } = endereco;
    const ag = this.agregadoDe(endereco);
    const projeto = carregarProjeto(banco, ag.demanda.projeto);
    const pendentes = existe(
      ag.encerramento,
      `a demanda ${demanda_id} não tem progresso de encerramento`,
      "registre a tentativa antes",
    ).limpeza_pendente;
    const ciclo = this.cicloDoEspacoDaDemanda(projeto, demanda_id);
    const feito = await ciclo.limpar(pendentes);
    const sobras = [...feito.pendentes, ...(await sobrasDaDemanda(ciclo.ambiente, projeto, feito.removidos))];
    const demonstracao = montarDemonstracaoLimpeza(feito.removidos, sobras);
    const { sessoes, execucoes, usos } = carregarSessoesDoContexto(banco, { demanda_id: demanda_id, ticket_id: null });
    // Com sobras só a demonstração é submetida: o Avaliador a recusa e nada é gravado.
    const submissoes = [
      ...(sobras.length === 0
        ? [
            {
              tipo: "arvore_prs_criterios_custos" as const,
              dados: montarArvorePRs(
                carregarDemanda(banco, demanda_id),
                sessoes,
                execucoes,
                usos,
                lerUsoDeclarado(banco, demanda_id),
              ),
            },
          ]
        : []),
      { tipo: "demonstracao_limpeza" as const, dados: demonstracao },
    ];
    for (const { tipo, dados } of submissoes) {
      const avaliacao = submeterEvidencia(
        banco,
        { tipo, dono: endereco, produtor: FABRIQUINHA, dados, anexos: [] },
        { origens: SEM_ORIGEM_DE_ANEXO },
      );
      if (avaliacao.resultado === "recusada") {
        if (sobras.length > 0) {
          this.falharPasso(
            endereco,
            "limpeza",
            falhaQueExigeOAuditor(`${avaliacao.motivo}: a limpeza deixou ${sobras.join(", ")}`),
            sobras,
          );
          return "parar";
        }
        // A falha de limpeza exige pendências; a evidência inválida falha só o ticket, e reaberto ele submete de novo.
        registrarFalhaDoTicket(banco, this.ticketDe(endereco), falhaQueExigeOAuditor(avaliacao.motivo), relogio);
        return "parar";
      }
    }
    const concluirDesenvolvimento = this.opcoes.concluirDesenvolvimento ?? soOEncerramentoDoProcesso;
    concluirDesenvolvimento(demanda_id, () => {
      concluirEncerramentoDaDemanda(banco, demanda_id, { demanda_id, limpeza_pendente: [] }, FABRIQUINHA, relogio);
    });
    return "seguir";
  }

  private agregadoDe(endereco: Endereco): AgregadoDemanda {
    return carregarDemanda(this.deps.banco, endereco.demanda_id);
  }

  /** Registra a falha do passo no encerramento e no ticket. */
  private falharPasso(
    endereco: Endereco,
    passo: NomeDoPasso,
    falha: FalhaDaTentativa,
    limpeza_pendente: string[] = [],
  ): void {
    const { banco, relogio } = this.deps;
    registrarFalhaDoEncerramento(
      banco,
      endereco.demanda_id,
      {
        demanda_id: endereco.demanda_id,
        etapa: passo,
        motivo: falha.motivo,
        ...(falha.tipo === "falha_infraestrutura" && { causa: falha.causa }),
        limpeza_pendente,
      },
      FABRIQUINHA,
      relogio,
    );
  }
}
