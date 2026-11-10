import { ErroDeRegra } from "../../nucleo/erros.ts";
import { schemaDoTipo, TipoEvidencia } from "../../nucleo/evidencia.ts";
import { CATALOGO_ETAPAS } from "../../nucleo/evidencia_etapa.ts";
import type { EsquemaDeEvidencia } from "../../nucleo/schemas.ts";

/** Os tipos de produtor agente do catálogo das etapas: os únicos que o agente submete. */
const TIPOS_QUE_O_AGENTE_SUBMETE: readonly TipoEvidencia[] = [
  ...new Set(CATALOGO_ETAPAS.filter((i) => i.produtor === "agente").map((i) => i.tipo)),
];

/** O tipo que o agente submete e o schema dele; os demais tipos não têm comando do agente. */
export function tipoDoAgente(texto: string): { tipo: TipoEvidencia; schema: EsquemaDeEvidencia } {
  const tipo = TipoEvidencia.safeParse(texto);
  if (!tipo.success || !TIPOS_QUE_O_AGENTE_SUBMETE.includes(tipo.data)) {
    throw new ErroDeRegra(
      `${texto} não é evidência que o agente submete`,
      `use um de ${TIPOS_QUE_O_AGENTE_SUBMETE.join(", ")}`,
    );
  }
  return { tipo: tipo.data, schema: schemaDoTipo(tipo.data) };
}
