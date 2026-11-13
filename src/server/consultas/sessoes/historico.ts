// A consulta do Histórico e da navegação: as sessões de demanda do escopo, lidas num snapshot só e no formato do
// contrato da API.
import type { DatabaseSync } from "node:sqlite";
import { ErroDeRegra } from "../../../modulos/compartilhado/nucleo/erros.ts";
import { Endereco } from "../../../modulos/compartilhado/nucleo/vocabulario_do_sdlc/endereco.ts";
import { lerEmSnapshot } from "../../../modulos/compartilhado/armazenamento/snapshot.ts";
import type { FiltroDeSessoes, SessaoDeDemanda } from "../../contrato/sessoes/historico.ts";
import { sessoesDeDemanda } from "./historico_demanda.ts";

/** O id da demanda do filtro, que só pode ser o endereço de uma demanda (`I-12` ou `12`). */
function demandaDoEndereco(texto: string): string {
  const endereco = Endereco.ler(texto);
  if (endereco.rodada_id !== undefined || endereco.ticket_id !== undefined) {
    throw new ErroDeRegra(`${texto} não é o endereço de uma demanda`, "use I-n, como I-206");
  }
  return endereco.demanda_id;
}

/** As sessões do `filtro`, da que está assim há mais tempo para a mais recente. */
export function consultarHistorico(banco: DatabaseSync, { demanda, ...filtro }: FiltroDeSessoes): SessaoDeDemanda[] {
  return lerEmSnapshot(banco, () =>
    sessoesDeDemanda(banco, {
      ...filtro,
      ...(demanda !== undefined && { demanda: demandaDoEndereco(demanda) }),
    }),
  );
}
