import type { Demanda } from "../../../../../modulos/ciclo_de_vida/publico.ts";

/** A demanda como o CLI a mostra: `criada_por` segue como `origem_ferramenta` e `origem_sessao`, no mesmo lugar do JSON. */
export const demandaParaCli = (demanda: Demanda): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(demanda).flatMap(([campo, valor]) =>
      campo === "criada_por"
        ? [
            ["origem_ferramenta", demanda.criada_por.ferramenta],
            ["origem_sessao", demanda.criada_por.sessao],
          ]
        : [[campo, valor]],
    ),
  );
