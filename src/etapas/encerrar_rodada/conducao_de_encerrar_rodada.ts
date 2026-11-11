// A condução do `encerrar_rodada`: o pi escreve a documentação do PR; depois dele a Fabriquinha grava a produtividade,
// incorpora a ponta da demanda, publica o PR da rodada e o confere. O ticket fica em execução, âncora do gate do PR.
import { existe } from "../../compartilhado/nucleo/erros.ts";
import { secaoDoPromptDoEncerrarRodada } from "./secao_do_prompt.ts";
import { DEFINICAO_DO_ENCERRAR_RODADA } from "./definicao.ts";
import type { Endereco } from "../../compartilhado/nucleo/vocabulario_do_sdlc/endereco.ts";
import { falhaDoErro } from "../../compartilhado/nucleo/vocabulario_do_sdlc/resultado_da_tentativa.ts";
import { raizDo } from "../../compartilhado/armazenamento/banco.ts";
import { carregarDemanda } from "../../sdlc/armazenamento/demandas.ts";
import { aprovarPRRodadaSeAutomatico } from "./gate_do_pr/aprovacao_pr_rodada.ts";
import { conferirEncerramentoRodada, type RefRodada } from "./encerramento_rodada.ts";
import { ConducaoAgentica, type ResultadoDaConferencia } from "../conducao/conducao_de_etapa.ts";
import { type DepsDaConducao } from "../../sdlc/aplicacao/despacho/despacho.ts";

export class ConducaoDeEncerrarRodada extends ConducaoAgentica {
  protected override readonly secaoDoPrompt = secaoDoPromptDoEncerrarRodada;

  constructor(deps: DepsDaConducao) {
    super(DEFINICAO_DO_ENCERRAR_RODADA, deps);
  }

  /** O erro da publicação ou da conferência falha o ticket; com PR problemático a rodada volta a `implementar` e é sucesso. */
  protected override async conferirResultado(endereco: Endereco): Promise<ResultadoDaConferencia> {
    const { banco, relogio, registro } = this.deps;
    try {
      await conferirEncerramentoRodada(banco, relogio, this.rodadaDe(endereco));
      return { tipo: "sucesso" };
    } catch (erro) {
      const falha = falhaDoErro(erro);
      registro(`${raizDo(banco)}/log`, `encerramento da rodada falhou: ${falha.motivo}`);
      return falha;
    }
  }

  /** No projeto com a aprovação automática, o PR que chegou ao gate é aprovado ali mesmo. */
  protected override async aoConcluir(endereco: Endereco): Promise<void> {
    const { banco } = this.deps;
    const ref = this.rodadaDe(endereco);
    await aprovarPRRodadaSeAutomatico(banco, carregarDemanda(banco, ref.demanda_id), ref);
  }

  private rodadaDe(endereco: Endereco): RefRodada {
    const ticket = this.ticketDe(endereco);
    const rodada_id = existe(
      ticket.rodada_id,
      `o ticket ${endereco.toString()} não é de uma rodada`,
      "use um ticket de rodada",
    );
    return { demanda_id: ticket.demanda_id, rodada_id };
  }
}
