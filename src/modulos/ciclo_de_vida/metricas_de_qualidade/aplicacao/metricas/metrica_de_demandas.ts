// As demandas do SDLC inteiro no recorte: quantas foram registradas e quantas concluídas nele.
import { noPeriodo, registroDoPedido } from "../../nucleo/metrica.ts";
import { type FatoDatado, MetricaDoSdlc } from "../calculo_de_metrica.ts";
import { type EscopoDosFatos, primeiraEvidenciaDoEscopo } from "../leitura_dos_fatos.ts";

/** Os instantes em que as demandas do recorte foram registradas e, as concluídas, concluídas; os dois no período. */
interface FatosDasDemandas {
  registradas: FatoDatado[];
  concluidas: FatoDatado[];
}

export class MetricaDeDemandas extends MetricaDoSdlc<
  "demandas",
  FatosDasDemandas,
  { registradas: number; concluidas: number }
> {
  readonly definicao = { tipo: "demandas", rotulo: "Demandas", fonte: "Registro e conclusão das demandas" } as const;

  /** A conclusão sem instante gravado (a demanda nova) cai na última mudança de estado. */
  protected lerFatos(escopo: EscopoDosFatos): FatosDasDemandas {
    const primeiraEvidencia = primeiraEvidenciaDoEscopo(escopo);
    return {
      registradas: escopo.pedidos
        .map((pedido) => ({ demanda_id: pedido.id, em: registroDoPedido(pedido, primeiraEvidencia.get(pedido.id)) }))
        .filter(({ em }) => noPeriodo(em, escopo.periodo)),
      concluidas: escopo.pedidos
        .filter((pedido) => pedido.estado === "concluida")
        .map((pedido) => ({ demanda_id: pedido.id, em: pedido.concluidaEm ?? pedido.estadoAlteradoEm }))
        .filter(({ em }) => noPeriodo(em, escopo.periodo)),
    };
  }

  formula({ registradas, concluidas }: FatosDasDemandas) {
    return { registradas: registradas.length, concluidas: concluidas.length };
  }
}
