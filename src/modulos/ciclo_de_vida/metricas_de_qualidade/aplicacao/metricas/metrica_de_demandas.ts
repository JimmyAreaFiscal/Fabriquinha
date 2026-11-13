// As demandas do SDLC inteiro no recorte: quantas foram registradas e quantas concluídas nele.
import { primeiraEvidenciaDasDemandas } from "../../../evidencias/publico.ts";
import { noPeriodo, registroDoPedido } from "../../nucleo/metrica.ts";
import { MetricaDoSdlc } from "../calculo_de_metrica.ts";
import type { EscopoDosFatos } from "../leitura_dos_fatos.ts";

/** Os instantes em que as demandas do recorte foram registradas e, as concluídas, concluídas; os dois no período. */
interface FatosDasDemandas {
  registradas: string[];
  concluidas: string[];
}

export class MetricaDeDemandas extends MetricaDoSdlc<
  "demandas",
  FatosDasDemandas,
  { registradas: number; concluidas: number }
> {
  readonly definicao = { tipo: "demandas", rotulo: "Demandas", fonte: "Registro e conclusão das demandas" } as const;

  /** A conclusão sem instante gravado (a demanda nova) cai na última mudança de estado. */
  protected lerFatos(escopo: EscopoDosFatos): FatosDasDemandas {
    const primeiraEvidencia = primeiraEvidenciaDasDemandas(escopo.banco, escopo.demandas);
    return {
      registradas: escopo.pedidos
        .map((pedido) => registroDoPedido(pedido, primeiraEvidencia.get(pedido.id)))
        .filter((instante) => noPeriodo(instante, escopo.periodo)),
      concluidas: escopo.pedidos
        .filter((pedido) => pedido.estado === "concluida")
        .map((pedido) => pedido.concluidaEm ?? pedido.estadoAlteradoEm)
        .filter((instante) => noPeriodo(instante, escopo.periodo)),
    };
  }

  formula({ registradas, concluidas }: FatosDasDemandas) {
    return { registradas: registradas.length, concluidas: concluidas.length };
  }
}
