// A condução do `encerrar_demanda` (comparacao-sdlc-implementacao.md §§5 e 6), sem agente, gate nem nota: PR final da
// branch da demanda para a base do projeto (D02), conflito (D06), check final, espera do merge humano na plataforma
// (a integração final depende do humano), integração confirmada com SHA, limpeza por posse e evidências. Cada efeito
// externo é seguido da transição do domínio, que decide se ele se repete (progresso recuperável).
import { FABRIQUINHA } from "../../nucleo/ator.ts";
import { type AgregadoDemanda, prDaDemanda } from "../../nucleo/agregado_demanda.ts";
import { existe } from "../../nucleo/erros.ts";
import { CATALOGO_DE_ETAPAS } from "../../nucleo/etapa.ts";
import { espacoDaDemanda } from "../../nucleo/espaco_de_trabalho.ts";
import type { Endereco } from "../../nucleo/item_de_trabalho.ts";
import { type FalhaDaTentativa, falhaDoErro, falhaQueExigeOAuditor } from "../../nucleo/tentativa.ts";
import { registrarFalhaTicket } from "../../nucleo/transicoes_demanda.ts";
import {
  concluirEncerramento,
  registrarConflitoEncerramento,
  registrarFalhaEncerramento,
  registrarIntegracao,
  registrarTentativaEncerramento,
  solicitarIntegracao,
} from "../../nucleo/transicoes_encerramento.ts";
import { raizDo } from "../../armazenamento/banco.ts";
import { carregarDemanda, comDemanda } from "../../armazenamento/demandas.ts";
import type { Projeto } from "../../nucleo/projeto.ts";
import { carregarProjeto } from "../../armazenamento/projetos.ts";
import { carregarTrabalhosDaDemanda } from "../../armazenamento/trabalho_agentico.ts";
import { lerUsoDeclarado } from "../../armazenamento/uso_declarado.ts";
import { logDaOperacao } from "../../infra/registro.ts";
import { pendenciasDeLimpeza, sobrasDaDemanda } from "../../infra/repositorio/limpeza_demanda.ts";
import { lerPR, type OpcoesVerificacao } from "../../infra/repositorio/pr.ts";
import { ConferenciaDoPR } from "../../infra/verificacao/conferencia_do_pr.ts";
import { montarVerificacoesDaEtapa } from "../../infra/verificacao/verificacao.ts";
import { ambienteDoServico } from "../espaco/ambiente_do_servico.ts";
import { cicloDoEspaco } from "../espaco/ciclo_do_espaco.ts";
import { montarArvorePRs, montarDemonstracaoLimpeza } from "../evidencias/encerramento_demanda.ts";
import { submeterEvidencia } from "../evidencia/submeter.ts";
import { publicarPRFinal } from "../encerramento_demanda.ts";
import { varrerBase } from "../retrabalho.ts";
import {
  ConducaoDeterministica,
  type DepsDaConducao,
  type PassoDaEtapa,
  type ResultadoDoPasso,
} from "./conducao_de_etapa.ts";

export interface OpcoesDoEncerramentoDaDemanda {
  /** Espera da verificação do PR (limite, intervalo e carência); o padrão é o de produção. */
  verificacao?: OpcoesVerificacao;
}

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
    super(CATALOGO_DE_ETAPAS.encerrar_demanda, deps);
    this.opcoes = opcoes;
  }

  /** O ciclo do Espaço da demanda, no Ambiente do serviço, com o log do encerramento. */
  private cicloDoEspacoDaDemanda(projeto: Projeto, demanda_id: string): ReturnType<typeof cicloDoEspaco> {
    const raiz = raizDo(this.deps.banco);
    const log = logDaOperacao(raiz, `encerramento-${demanda_id}`);
    return cicloDoEspaco(espacoDaDemanda(projeto, demanda_id, raiz), projeto, { raiz, log }, ambienteDoServico());
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
    await varrerBase(banco, projeto.nome).catch(ciclo.anotarFalhaDaVarredura);
    const publicado = await publicarPRFinal(banco, ag, projeto, projeto.branch_base, raiz);
    this.aplicar(endereco, (a) =>
      registrarTentativaEncerramento(
        a,
        {
          demanda_id,
          base: projeto.branch_base,
          pr: { numero: Number(publicado.id), url: publicado.url },
          sha: publicado.head,
        },
        FABRIQUINHA,
        relogio(),
      ),
    );

    try {
      const { conferencia_do_pr: conferenciaDoPR } = montarVerificacoesDaEtapa("encerrar_demanda", {
        conferencia_do_pr: () => new ConferenciaDoPR(projeto, publicado.id, log, this.opcoes.verificacao),
      });
      const problemas = await conferenciaDoPR.conferir();
      if (problemas.conflito) {
        this.aplicar(endereco, (a) => registrarConflitoEncerramento(a, { demanda_id }, FABRIQUINHA, relogio()));
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

    this.aplicar(endereco, (a) => solicitarIntegracao(a, { demanda_id }, FABRIQUINHA, relogio()));
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
      this.aplicar(endereco, (a) => solicitarIntegracao(a, { demanda_id }, FABRIQUINHA, relogio()));
    };
    let leitura;
    try {
      leitura = await lerPR(projeto, String(pr.numero));
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
    this.aplicar(endereco, (a) =>
      registrarIntegracao(
        a,
        { demanda_id, confirmada: true, sha, limpeza_pendente: pendentes },
        FABRIQUINHA,
        relogio(),
      ),
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
    const { sessoes, execucoes, usos } = carregarTrabalhosDaDemanda(banco, demanda_id);
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
        const { ticket_id } = this.ticketDe(endereco);
        this.aplicar(endereco, (a) =>
          registrarFalhaTicket(a, { ticket_id, falha: falhaQueExigeOAuditor(avaliacao.motivo) }, relogio()),
        );
        return "parar";
      }
    }
    this.aplicar(endereco, (a) =>
      concluirEncerramento(a, { demanda_id, limpeza_pendente: [] }, FABRIQUINHA, relogio()),
    );
    return "seguir";
  }

  private agregadoDe(endereco: Endereco): AgregadoDemanda {
    return carregarDemanda(this.deps.banco, endereco.demanda_id);
  }

  private aplicar(endereco: Endereco, transicao: (ag: AgregadoDemanda) => AgregadoDemanda): void {
    comDemanda(this.deps.banco, endereco.demanda_id, transicao);
  }

  /** Registra a falha do passo no encerramento e no ticket. */
  private falharPasso(
    endereco: Endereco,
    passo: NomeDoPasso,
    falha: FalhaDaTentativa,
    limpeza_pendente: string[] = [],
  ): void {
    const { relogio } = this.deps;
    this.aplicar(endereco, (a) =>
      registrarFalhaEncerramento(
        a,
        {
          demanda_id: endereco.demanda_id,
          etapa: passo,
          motivo: falha.motivo,
          ...(falha.tipo === "falha_infraestrutura" && { causa: falha.causa }),
          limpeza_pendente,
        },
        FABRIQUINHA,
        relogio(),
      ),
    );
  }
}
