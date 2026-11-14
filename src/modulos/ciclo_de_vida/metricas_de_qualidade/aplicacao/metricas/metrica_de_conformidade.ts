// Conformidade do PR da rodada com o plano aprovado original: Jaccard entre os arquivos planejados e os alterados
// (comparacao-sdlc-implementacao.md §8).
import { encontrado } from "../../../../../shared/nucleo/erros.ts";
import { planosDasDemandas } from "../../../planejamento/publico.ts";
import { noPeriodo } from "../../nucleo/metrica.ts";
import { MetricaPorEtapa } from "../calculo_de_metrica.ts";
import { type EscopoDosFatos, lerCommitsDoEscopo, ticketsCitados } from "../leitura_dos_fatos.ts";

interface ArquivoDaRodada {
  caminho: string;
  caminhoAnterior: string | null;
}

/** Uma rodada cujo último commit de ticket cai no recorte, com os caminhos do plano original e os arquivos dos commits dela. */
interface RodadaAComparar {
  demanda_id: string;
  /** O instante do último commit de ticket da rodada. */
  em: string;
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
  commits: ReturnType<typeof lerCommitsDoEscopo>;
}

const chaveDaRodada = (demandaId: string, rodadaId: number) => `${demandaId}\0${String(rodadaId).padStart(12, "0")}`;

export class MetricaDeConformidade extends MetricaPorEtapa<
  { rodadas: RodadaAComparar[] },
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
  protected lerFatos(escopo: EscopoDosFatos): { rodadas: RodadaAComparar[] } {
    const commits = lerCommitsDoEscopo(escopo);
    const ticketDe = ticketsCitados(escopo);
    const porRodada = new Map<string, RodadaComCommits>();
    for (const commit of commits) {
      const rodadaId = ticketDe(commit.demanda_id, commit.ticket_id).rodada_id;
      if (rodadaId === null) continue;
      const chave = chaveDaRodada(commit.demanda_id, rodadaId);
      const rodada = porRodada.get(chave) ?? { demandaId: commit.demanda_id, rodadaId, instantes: [], commits: [] };
      rodada.instantes.push(commit.em);
      rodada.commits.push(commit);
      porRodada.set(chave, rodada);
    }
    const rodadas = [...porRodada.keys()]
      .sort()
      .map((chave) => encontrado(porRodada.get(chave), `a rodada ${chave} sumiu`, "leia as chaves do próprio mapa"))
      .map((rodada) => ({ ...rodada, ultimoCommit: (rodada.instantes.toSorted().reverse() as [string])[0] }))
      .filter(({ ultimoCommit }) => noPeriodo(ultimoCommit, escopo.periodo));
    const planos = planosDasDemandas(escopo.banco, [...new Set(rodadas.map((rodada) => rodada.demandaId))]);
    return {
      rodadas: rodadas.map((rodada) => ({
        demanda_id: rodada.demandaId,
        em: rodada.ultimoCommit,
        demandaId: rodada.demandaId,
        rodadaId: rodada.rodadaId,
        planejados: planos.get(rodada.demandaId)?.original.rodadas.find((r) => r.rodada_id === rodada.rodadaId)
          ?.arquivos_previstos,
        arquivos: rodada.commits.flatMap((commit) => commit.arquivos),
      })),
    };
  }

  formula({ rodadas: rodadasAComparar }: { rodadas: RodadaAComparar[] }) {
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
