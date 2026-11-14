// As Etapas do SDLC como a API as serve (`GET /api/etapas`): o app.ts as carrega antes da primeira página, e as telas
// leem daqui o rótulo, a ordem, os estados e o papel de cada Etapa, sem citá-las pelo nome. Acrescentar uma Etapa ao
// catálogo a faz aparecer nas telas sem mexer na web.
import type { EtapaDoSdlc, EtapasDoSdlc } from "../../system/api/contrato/etapas.ts";
import type {
  EstadoDemanda,
  EstadoRodada,
  EtapaTicket,
  NomeGate,
  PapelDaEtapa,
} from "../../../modulos/ciclo_de_vida/publico.ts";

let etapasCarregadas: EtapasDoSdlc | undefined;

/** Guarda as Etapas que a API serviu: o app.ts, antes de desenhar a primeira página; os testes, com as do catálogo. */
export function definirEtapasDoSdlc(etapas: EtapasDoSdlc): void {
  etapasCarregadas = etapas;
}

/** As Etapas, a ordem do SDLC e os estados dos ciclos, como a API os serviu. */
export function etapasDoSdlc(): EtapasDoSdlc {
  if (etapasCarregadas === undefined) throw new Error("as Etapas do SDLC ainda não vieram da API (GET /api/etapas)");
  return etapasCarregadas;
}

export function etapaDoSdlc(nome: EtapaTicket): EtapaDoSdlc {
  const etapa = etapasDoSdlc().etapas.find((candidata) => candidata.nome === nome);
  if (etapa === undefined) throw new Error(`a Etapa ${nome} não veio da API (GET /api/etapas)`);
  return etapa;
}

/** A Etapa que cumpre o papel nas regras do motor: a tela pergunta por ele, como o motor, em vez de citá-la pelo nome. */
export function etapaDoPapel(papel: PapelDaEtapa): EtapaTicket {
  const etapa = etapasDoSdlc().etapas.find((candidata) => candidata.papel === papel);
  if (etapa === undefined) throw new Error(`nenhuma Etapa da API tem o papel ${papel}`);
  return etapa.nome;
}

/** O ticket da Etapa como as telas o mostram: "Planejamento". */
export const rotuloDaEtapa = (nome: EtapaTicket): string => etapaDoSdlc(nome).exibicao.rotulo;

/** O título do ticket que não tem um: o que a Etapa faz. */
export const tituloPadraoDaEtapa = (nome: EtapaTicket): string => etapaDoSdlc(nome).exibicao.tituloPadrao;

/** O nome da fase do processo (Registrar, Planejar, Implementar, Revisar, Encerrar) que a Etapa abre: o verbo do título dela. */
const faseDoProcesso = (nome: EtapaTicket): string => tituloPadraoDaEtapa(nome).replace(/ .*/, "");

const comInicialMaiuscula = (texto: string): string => texto.charAt(0).toUpperCase() + texto.slice(1);

/** A Etapa cujo Gate espera a decisão do Auditor num estado só dele, com o nome do Gate. */
const etapaQueEsperaNoEstado = (estado: string): EtapaDoSdlc | undefined =>
  etapasDoSdlc().etapas.find((etapa) => etapa.gate?.esperaEmEstadoProprio === true && etapa.gate.nome === estado);

/** O Gate como as telas o citam no meio da frase: "aprovação do PR". */
export function rotuloDoGate(nome: NomeGate): string {
  const etapa = etapasDoSdlc().etapas.find((candidata) => candidata.gate?.nome === nome);
  if (etapa?.gate === undefined) throw new Error(`nenhuma Etapa da API tem o Gate ${nome}`);
  return etapa.gate.rotulo;
}

/** Os estados que são do motor e não de uma Etapa ou de um Gate: a execução das rodadas e os terminais. */
const APARENCIA_DOS_ESTADOS_DO_MOTOR: Readonly<Record<string, readonly [rotulo: string, pilula: string]>> = {
  em_execucao: ["Execução", "pill-rodando"],
  concluida: ["Concluída", "pill-ok"],
  arquivada: ["Arquivada", "pill-neutro"],
  cancelada: ["Cancelada", "pill-cancelada"],
};

/** O estado da demanda ou da rodada como as telas o mostram, com a cor da pílula: o da Etapa, o do Gate ou o do motor. */
export function aparenciaDoEstado(estado: EstadoDemanda | EstadoRodada): readonly [rotulo: string, pilula: string] {
  const comoEstado = etapasDoSdlc().etapas.find((etapa) => etapa.nome === estado)?.exibicao.comoEstado;
  if (comoEstado) return [comoEstado.rotulo, `pill-${comoEstado.tom}`];
  const gate = etapaQueEsperaNoEstado(estado)?.gate;
  if (gate) return [comInicialMaiuscula(gate.rotulo), "pill-aguarda"];
  const doMotor = APARENCIA_DOS_ESTADOS_DO_MOTOR[estado];
  if (doMotor === undefined) throw new Error(`o estado ${estado} não é de Etapa, de Gate nem do motor`);
  return doMotor;
}

/** O estado do motor em que as rodadas da demanda rodam: no andamento, os estados da rodada tomam o lugar dele. */
export const ESTADO_DA_EXECUCAO = "em_execucao";

/** Uma coluna do andamento: um estado de uma Etapa ou de um Gate que espera o Auditor, com os rótulos das telas. */
export interface ColunaDoAndamento {
  estado: EstadoDemanda | EstadoRodada;
  de: "demanda" | "rodada";
  gate: boolean;
  /** O rótulo no board do Início e o da linha do tempo do Projeto, que é mais estreita. */
  noInicio: string;
  noProjeto: string;
}

function colunaDoEstado(estado: EstadoDemanda | EstadoRodada, de: "demanda" | "rodada"): ColunaDoAndamento[] {
  const comoEstado = etapasDoSdlc().etapas.find((etapa) => etapa.nome === estado)?.exibicao.comoEstado;
  if (comoEstado) {
    return [{ estado, de, gate: false, noInicio: comoEstado.colunaNoInicio, noProjeto: comoEstado.colunaNoProjeto }];
  }
  const gate = etapaQueEsperaNoEstado(estado)?.gate;
  if (gate === undefined) return [];
  const rotulo = comInicialMaiuscula(gate.rotulo);
  return [{ estado, de, gate: true, noInicio: rotulo, noProjeto: rotulo }];
}

/**
 * Os estados em andamento, na ordem dos ciclos: os da demanda e, no lugar da execução, os da rodada. Os do motor (a
 * execução e os terminais) ficam de fora.
 */
export function colunasDoAndamento(): ColunaDoAndamento[] {
  const { estados } = etapasDoSdlc();
  return estados.demanda.flatMap((estado) =>
    estado === ESTADO_DA_EXECUCAO
      ? estados.rodada.flatMap((daRodada) => colunaDoEstado(daRodada, "rodada"))
      : colunaDoEstado(estado, "demanda"),
  );
}

/**
 * Os estados da demanda em andamento, na ordem do ciclo, com a execução no lugar das rodadas: o caminho que a demanda
 * percorre até a conclusão.
 */
export const estadosDaDemandaEmAndamento = (): EstadoDemanda[] =>
  etapasDoSdlc().estados.demanda.filter(
    (estado) => estado === ESTADO_DA_EXECUCAO || colunaDoEstado(estado, "demanda").length > 0,
  );

/**
 * As Etapas na ordem do fluxo da demanda: a do SDLC, com as da rodada no lugar da execução, e depois as que rodam fora
 * dela, as da demanda antes das da rodada.
 */
export function etapasNaOrdemDoFluxo(): EtapaTicket[] {
  const { etapas, ordem } = etapasDoSdlc();
  const naOrdem = ordem.demanda.flatMap((estado) => {
    if (estado === ESTADO_DA_EXECUCAO) return ordem.rodada;
    return etapas.flatMap((etapa) => (etapa.nome === estado ? [etapa.nome] : []));
  });
  const foraDaOrdem = (escopo: EtapaDoSdlc["escopo"]) =>
    etapas.filter((etapa) => etapa.escopo === escopo && !naOrdem.includes(etapa.nome)).map((etapa) => etapa.nome);
  return [...naOrdem, ...foraDaOrdem("demanda"), ...foraDaOrdem("rodada")];
}

/**
 * As fases do processo sobre as colunas do andamento: cada uma com o verbo da Etapa que a abre e quantas colunas agrupa,
 * até a coluna da Etapa seguinte que abre fase.
 */
export function fasesSobreAsColunas(
  colunas: readonly ColunaDoAndamento[],
  abreFase: (estado: ColunaDoAndamento["estado"]) => boolean,
): { rotulo: string; colunas: number }[] {
  const fases: { rotulo: string; colunas: number }[] = [];
  for (const { estado } of colunas) {
    const ultima = fases.at(-1);
    if (ultima === undefined || abreFase(estado))
      fases.push({ rotulo: faseDoProcesso(estado as EtapaTicket), colunas: 1 });
    else ultima.colunas += 1;
  }
  return fases;
}
