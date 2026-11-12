// O relatório do ensaio de desempenho em Markdown: uma tabela por volume, com o p50, o p95 e as execuções SQL de cada rota.
import type { VolumeSintetico } from "./semeadura_dos_volumes.ts";

export interface MedicaoDaRota {
  /** A tela que pede a rota, como o menu a chama. */
  tela: string;
  /** O caminho pedido, com a query que a tela manda. */
  caminho: string;
  p50: number;
  p95: number;
  execucoesSql: number;
}

export interface MedicoesDoVolume {
  volume: VolumeSintetico;
  rotas: MedicaoDaRota[];
}

interface CabecalhoDaMedicao {
  medidaEm: string;
  maquina: string;
  chamadasPorRota: number;
}

const emMilissegundos = (tempo: number): string => tempo.toFixed(1);

function tabelaDoVolume({ volume, rotas }: MedicoesDoVolume): string[] {
  return [
    `## ${volume.nome}: ${String(volume.demandas)} demandas em ${String(volume.meses)} meses`,
    "",
    "| Tela | Rota | p50 (ms) | p95 (ms) | Execuções SQL |",
    "| --- | --- | --: | --: | --: |",
    ...rotas.map(
      (rota) =>
        `| ${rota.tela} | \`${rota.caminho}\` | ${emMilissegundos(rota.p50)} | ${emMilissegundos(rota.p95)} | ${String(rota.execucoesSql)} |`,
    ),
    "",
  ];
}

export function montarRelatorioDaReferencia(
  medicoesPorVolume: readonly MedicoesDoVolume[],
  { medidaEm, maquina, chamadasPorRota }: CabecalhoDaMedicao,
): string {
  return [
    "# Referência de desempenho das rotas de leitura",
    "",
    "Gerado por `npm run estresse:referencia`; não edite à mão.",
    `Medida em ${medidaEm}, em ${maquina}.`,
    `Cada rota: ${String(chamadasPorRota)} chamadas seguidas para os tempos e 1 chamada antes delas para contar as execuções SQL.`,
    "",
    ...medicoesPorVolume.flatMap(tabelaDoVolume),
  ].join("\n");
}
