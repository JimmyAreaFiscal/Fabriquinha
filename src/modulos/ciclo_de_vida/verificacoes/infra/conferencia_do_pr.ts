// A conferência do PR na hospedagem (F5 §5.1, passo 4): conflito ou check falho reprova; a hospedagem que não decide no
// limite é falha de infraestrutura. Não gera Evidência.
import { ErroExterno } from "../../../../shared/nucleo/erros.ts";
import { falhaDoErro } from "../../etapas/publico.ts";
import type { ResultadoDaVerificacao } from "../nucleo/verificacao.ts";
import type {
  OpcoesVerificacao,
  ProblemasDoPR,
  ProjetoDoRepositorio,
  RepositorioDoProjeto,
} from "../../../repositorio/publico.ts";
import { Verificacao } from "./verificacao.ts";

/** Os padrões da espera (limite de 60 min, leitura a cada 10 s e carência de 1 min) são os de `problemasDoPR`. */
export class ConferenciaDoPR extends Verificacao {
  readonly tipo = "conferencia_do_pr";
  readonly #repositorio: Pick<RepositorioDoProjeto, "problemasDoPR">;
  readonly #projeto: Pick<ProjetoDoRepositorio, "raiz_git" | "hospedagem">;
  readonly #idDoPR: string;
  readonly #log: string;
  readonly #opcoes: OpcoesVerificacao | undefined;

  constructor(
    repositorio: Pick<RepositorioDoProjeto, "problemasDoPR">,
    projeto: Pick<ProjetoDoRepositorio, "raiz_git" | "hospedagem">,
    idDoPR: string,
    log: string,
    opcoes?: OpcoesVerificacao,
  ) {
    super();
    this.#repositorio = repositorio;
    this.#projeto = projeto;
    this.#idDoPR = idDoPR;
    this.#log = log;
    this.#opcoes = opcoes;
  }

  /** Os problemas com o detalhe que o chamador transforma em correções; a hospedagem que não decide lança ErroExterno. */
  conferir(): Promise<ProblemasDoPR> {
    return this.#repositorio.problemasDoPR(this.#projeto, this.#idDoPR, this.#log, this.#opcoes);
  }

  /** Só o erro externo da hospedagem vira resultado; qualquer outro propaga. */
  async executar(): Promise<ResultadoDaVerificacao> {
    let problemas: ProblemasDoPR;
    try {
      problemas = await this.conferir();
    } catch (erro) {
      if (!(erro instanceof ErroExterno)) throw erro;
      return falhaDoErro(erro) as Extract<ResultadoDaVerificacao, { tipo: "falha_infraestrutura" }>;
    }
    const motivos = [
      ...(problemas.conflito ? [`o PR ${this.#idDoPR} conflita com a base`] : []),
      ...problemas.checksFalhos.map(({ nome, url }) => `check ${[nome, url].filter(Boolean).join(" ")} falhou`),
    ];
    return motivos.length === 0 ? { tipo: "passou" } : { tipo: "reprovacao", motivo: motivos.join("; "), log: "" };
  }
}
