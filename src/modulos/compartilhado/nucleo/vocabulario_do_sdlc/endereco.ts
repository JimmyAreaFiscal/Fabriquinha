// O endereço público de um Item de Trabalho (CONCEITOS.md §4 e §14): a demanda, a rodada ou o ticket, como o Auditor e o
// agente os escrevem. É vocabulário de todo o serviço, não só do motor.
import { ErroDeRegra } from "../erros.ts";

const FORMAS_DO_ENDERECO =
  "use I-n para a demanda (ou só o número), I-n.Rm para a rodada ou I-n.Tm para o ticket, como I-206, I-206.R2 ou I-206.T3";
// Até 10 algarismos, como o `DemandaId`: nenhum número passa do inteiro seguro.
const ENDERECO = /^(?:(?:[iI]-?)?([1-9][0-9]{0,9})|I-([1-9][0-9]{0,9})\.([RT])([1-9][0-9]{0,9}))$/;

/** O endereço público de um Item de Trabalho: `I-n` (demanda), `I-n.Rm` (rodada) ou `I-n.Tm` (ticket). */
export class Endereco {
  readonly demanda_id: string;
  readonly rodada_id?: number;
  readonly ticket_id?: number;

  private constructor(demanda_id: string, rodada_id?: number, ticket_id?: number) {
    this.demanda_id = demanda_id;
    this.rodada_id = rodada_id;
    this.ticket_id = ticket_id;
  }

  static daDemanda(demanda_id: string): Endereco {
    return new Endereco(demanda_id);
  }

  static daRodada(demanda_id: string, rodada_id: number): Endereco {
    return new Endereco(demanda_id, rodada_id);
  }

  static doTicket(demanda_id: string, ticket_id: number): Endereco {
    return new Endereco(demanda_id, undefined, ticket_id);
  }

  /** Lê `I-12` (também `i-12`, `i12`, `I12` e `12`), `I-12.R2` ou `I-12.T3`; qualquer outra forma é rejeitada dizendo o formato esperado. */
  static ler(texto: string): Endereco {
    const achado = ENDERECO.exec(texto);
    if (!achado) throw new ErroDeRegra(`endereço ${JSON.stringify(texto)} inválido`, FORMAS_DO_ENDERECO);
    const [, numeroDaDemanda, numero, letra, sufixo] = achado;
    if (numeroDaDemanda !== undefined) return Endereco.daDemanda(`I-${numeroDaDemanda}`);
    const demanda_id = `I-${String(numero)}`;
    return letra === "R"
      ? Endereco.daRodada(demanda_id, Number(sufixo))
      : Endereco.doTicket(demanda_id, Number(sufixo));
  }

  toString(): string {
    if (this.ticket_id !== undefined) return `${this.demanda_id}.T${String(this.ticket_id)}`;
    if (this.rodada_id !== undefined) return `${this.demanda_id}.R${String(this.rodada_id)}`;
    return this.demanda_id;
  }
}
