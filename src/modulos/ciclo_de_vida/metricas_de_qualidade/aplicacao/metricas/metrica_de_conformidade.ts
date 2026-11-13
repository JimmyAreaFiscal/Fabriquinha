// Conformidade do PR da rodada com o plano aprovado original: Jaccard entre os arquivos planejados e os alterados
// (comparacao-sdlc-implementacao.md §8).
import { arquivosDosCommits, commitsDosTicketsEmLote } from "../../../../repositorio/publico.ts";
import { encontrado } from "../../../../../shared/nucleo/erros.ts";
import { planosDasDemandas } from "../../../planejamento/publico.ts";
import { noPeriodo } from "../../nucleo/metrica.ts";
import { MetricaPorEtapa } from "../calculo_de_metrica.ts";
import { type EscopoDosFatos, ticketsCitados } from "../leitura_dos_fatos.ts";

interface ArquivoDaRodada {
  caminho: string;
  caminhoAnterior: string | null;
}

/** Uma rodada cujo último commit de ticket cai no recorte, com os caminhos do plano original e os arquivos dos commits dela. */
interface RodadaAComparar {
  demandaId: string;
  rodadaId: number;
  /** `undefined` sem plano aprovado ou sem a rodada nele (a corretiva). */
  planejados: string[] | undefined;
  arquivos: ArquivoDaRodada[];
}

interface ConformidadeDaRodada {
  demandaId: string;
  rodadaId: number;
  /** Jaccard em porcentagem, de 0 a 100. */
  percentual: number;
  comuns: number;
  uniao: number;
  ausentes: string[];
  extras: string[];
}

/** Renome conta pelo caminho novo, e o anterior só entra se estava no plano; exclusão já vem pelo caminho excluído. */
function conformidadeDe(planejados: string[], arquivos: ArquivoDaRodada[]) {
  const planejado = new Set(planejados);
  const alterado = new Set<string>();
  for (const a of arquivos) {
    alterado.add(a.caminho);
    if (a.caminhoAnterior !== null && planejado.has(a.caminhoAnterior)) alterado.add(a.caminhoAnterior);
  }
  const ausentes = [...planejado].filter((c) => !alterado.has(c));
  const extras = [...alterado].filter((c) => !planejado.has(c));
  const comuns = planejado.size - ausentes.length;
  const uniao = comuns + ausentes.length + extras.length;
  return { percentual: (comuns / uniao) * 100, comuns, uniao, ausentes, extras };
}

/**
 * A chave da rodada, que também a ordena como o SQLite ordenava: a demanda pelo texto (byte a byte, sem o idioma) e, nela,
 * a rodada pelo número.
 */
interface RodadaComCommits {
  demandaId: string;
  rodadaId: number;
  /** Os instantes dos commits dos tickets da rodada: o último diz se ela cai no recorte. */
  instantes: string[];
  shas: Set<string>;
}

const chaveDaRodada = (demandaId: string, rodadaId: number) => `${demandaId}\0${String(rodadaId).padStart(12, "0")}`;

export class MetricaDeConformidade extends MetricaPorEtapa<
  RodadaAComparar[],
  {
    /** O Jaccard de todas as rodadas do recorte juntas; `null` sem rodada com plano e commit. */
    percentual: number | null;
    comuns: number;
    uniao: number;
    rodadas: ConformidadeDaRodada[];
  }
> {
  readonly definicao = {
    tipo: "conformidade_com_o_plano",
    rotulo: "Conformidade do PR com o plano",
    fonte: "Plano × arquivos alterados",
  } as const;

  /** As rodadas cujo último commit de ticket cai no recorte: o escopo restringe os commits e o período, o último deles. */
  protected lerFatos(escopo: EscopoDosFatos): RodadaAComparar[] {
    const commits = commitsDosTicketsEmLote(escopo.banco, escopo.demandas);
    const ticketDe = ticketsCitados(escopo.banco, commits);
    const porRodada = new Map<string, RodadaComCommits>();
    for (const commit of commits) {
      const rodadaId = ticketDe(commit.demanda_id, commit.ticket_id).rodada_id;
      if (rodadaId === null) continue;
      const chave = chaveDaRodada(commit.demanda_id, rodadaId);
      const rodada = porRodada.get(chave) ?? { demandaId: commit.demanda_id, rodadaId, instantes: [], shas: new Set() };
      rodada.instantes.push(commit.em);
      rodada.shas.add(commit.sha);
      porRodada.set(chave, rodada);
    }
    const rodadas = [...porRodada.keys()]
      .sort()
      .map((chave) => encontrado(porRodada.get(chave), `a rodada ${chave} sumiu`, "leia as chaves do próprio mapa"))
      .filter((rodada) => {
        const [ultimoCommit] = rodada.instantes.toSorted().reverse() as [string];
        return noPeriodo(ultimoCommit, escopo.periodo);
      });
    const planos = planosDasDemandas(escopo.banco, [...new Set(rodadas.map((rodada) => rodada.demandaId))]);
    const arquivos = arquivosDosCommits(
      escopo.banco,
      rodadas.flatMap((rodada) => [...rodada.shas]),
    );
    return rodadas.map(({ demandaId, rodadaId, shas }) => ({
      demandaId,
      rodadaId,
      planejados: planos.get(demandaId)?.original.rodadas.find((r) => r.rodada_id === rodadaId)?.arquivos_previstos,
      arquivos: arquivos.filter((arquivo) => shas.has(arquivo.sha)),
    }));
  }

  formula(rodadasAComparar: RodadaAComparar[]) {
    // A referência é o original aprovado: o que as correções acrescentam não está nele e conta como extra.
    // Rodada corretiva (sem plano original) ou sem caminhos planejados não tem o que comparar.
    const rodadas = rodadasAComparar.flatMap(({ demandaId, rodadaId, planejados, arquivos }) =>
      planejados === undefined || planejados.length === 0
        ? []
        : [{ demandaId, rodadaId, ...conformidadeDe(planejados, arquivos) }],
    );
    const comuns = rodadas.reduce((soma, r) => soma + r.comuns, 0);
    const uniao = rodadas.reduce((soma, r) => soma + r.uniao, 0);
    const valor = { percentual: uniao === 0 ? null : (comuns / uniao) * 100, comuns, uniao, rodadas };
    return () => valor;
  }
}
