// Como a web mostra cada Etapa: os textos das telas, declarados com a definição da Etapa e servidos pela API
// (`GET /api/etapas`), para a web desenhar as Etapas sem citá-las pelo nome. Sem I/O.
import { z } from "zod";

/** A cor da pílula da Etapa como estado do ciclo: neutra, rodando ou à espera do Auditor. */
const TomDaPilula = z.enum(["neutro", "rodando", "aguarda"]);

export const ExibicaoDaEtapa = z.strictObject({
  /** O ticket da Etapa nas listas, no chat e no histórico: "Planejamento". */
  rotulo: z.string(),
  /** A Etapa como ação, no formulário de configuração dos agentes: "Planejar". */
  acao: z.string(),
  /** O título do ticket que não tem um: "Planejar a demanda"; a primeira palavra é a fase do processo que a Etapa abre. */
  tituloPadrao: z.string(),
  /** A seção da Etapa nas Métricas: o título e como ela trabalha. */
  nasMetricas: z.strictObject({ titulo: z.string(), modo: z.string() }),
  /**
   * Só a Etapa que é estado do ciclo dela: a pílula do estado e a coluna dele no board do Início e na linha do tempo do
   * Projeto, que é mais estreita.
   */
  comoEstado: z
    .strictObject({ rotulo: z.string(), tom: TomDaPilula, colunaNoInicio: z.string(), colunaNoProjeto: z.string() })
    .optional(),
});
export type ExibicaoDaEtapa = z.infer<typeof ExibicaoDaEtapa>;
