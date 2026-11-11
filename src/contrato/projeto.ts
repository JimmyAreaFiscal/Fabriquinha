// O contrato das rotas da página do projeto na API: as demandas com as rodadas e os tickets, o arquivamento das
// concluídas e o heatmap. Só tipos e schemas; quem monta cada resposta é a consulta da tela (api/consultas/).
import { z } from "zod";
import { TipoDemanda } from "../sdlc/nucleo/demanda/agregado_demanda.ts";
import { EstadoTicket, Instante } from "../compartilhado/nucleo/primitivos.ts";
import { EstadoDemanda, EstadoRodada } from "../sdlc/nucleo/ciclo_de_vida/ciclos.ts";
import { EtapaTicket } from "../etapas/catalogo.ts";
import { PendenciaDoInicio } from "./demanda.ts";

/** `GET /api/projetos/:nome/demandas?…`: as em andamento sempre; os demais estados só quando pedidos. */
export const FiltroDoProjeto = z.object({
  concluidas: z.stringbool().default(false),
  arquivadas: z.stringbool().default(false),
  canceladas: z.stringbool().default(false),
});
export type FiltroDoProjeto = z.infer<typeof FiltroDoProjeto>;

/** Uma linha da página do projeto: a demanda, as rodadas com o PR e os tickets com o modelo efetivo e a sessão. */
const DemandaDoProjeto = z.object({
  id: z.string(),
  titulo: z.string(),
  tipo: TipoDemanda,
  estado: EstadoDemanda,
  terminal: z.boolean(),
  satisfazDependencia: z.boolean(),
  /** O estado em que a linha do tempo marca a demanda. */
  estadoNaLinhaDoTempo: EstadoDemanda,
  estadoAlteradoEm: Instante,
  /** As predecessoras que ainda não satisfazem a dependência. */
  bloqueadaPor: z.array(z.string()),
  /** O que a demanda tem parado esperando o Auditor; a demanda encerrada não tem. */
  pendencias: z.array(PendenciaDoInicio),
  rodadas: z.array(
    z.object({
      ref: z.string(),
      titulo: z.string(),
      estado: EstadoRodada,
      pr: z.object({ id: z.string(), url: z.string() }).optional(),
    }),
  ),
  tickets: z.array(
    z.object({
      ref: z.string(),
      etapa: EtapaTicket,
      estado: EstadoTicket,
      terminal: z.boolean(),
      satisfazDependencia: z.boolean(),
      estadoAlteradoEm: Instante,
      rodada: z.string().optional(),
      titulo: z.string().optional(),
      /** `provedor / modelo` do ticket, senão o da etapa no projeto; sem ele, vale o padrão do pi. */
      modelo: z.string().optional(),
      sessao: z.string().optional(),
      /** Com execução de pi aberta: o `em_execucao` é o pi, não o sistema. */
      pi_ativo: z.literal(true).optional(),
    }),
  ),
});
export type DemandaDoProjeto = z.infer<typeof DemandaDoProjeto>;

/** `GET /api/projetos/:nome/demandas`: as demandas pedidas, das mais novas para as mais antigas, e a contagem de todas. */
export const ListaDoProjeto = z.object({
  demandas: z.array(DemandaDoProjeto),
  contagem: z.object({
    andamento: z.number().int(),
    concluidas: z.number().int(),
    arquivadas: z.number().int(),
    canceladas: z.number().int(),
  }),
});
export type ListaDoProjeto = z.infer<typeof ListaDoProjeto>;

/** `POST /api/projetos/:nome/arquivar`: quantas concluídas foram arquivadas. */
export const DemandasArquivadas = z.object({ arquivadas: z.number().int() });

const CommitDoHeatmap = z.object({
  hash: z.string(),
  mensagem: z.string(),
  data: z.string(),
  /** Número do PR que o mergeou; `null` para commit direto na base. */
  pr: z.string().nullable(),
});

const NoDoHeatmap = z.object({
  nome: z.string(),
  /** Pasta: soma dos arquivos abaixo dela. */
  alteracoes: z.number().int(),
  /** Só na pasta, do que mais mudou para o que menos mudou. */
  get filhos() {
    return z.array(NoDoHeatmap).optional();
  },
  /** Só no arquivo: hashes (chaves de `commits`) do mais novo ao mais antigo. */
  commits: z.array(z.string()).optional(),
});

/** `GET /api/projetos/:nome/heatmap`: quantas vezes cada arquivo mudou nos 12 meses até `ate`. */
export const Heatmap = z.object({
  branch: z.string(),
  desde: z.string(),
  ate: z.string(),
  raiz: NoDoHeatmap,
  commits: z.record(z.string(), CommitDoHeatmap),
});
export type Heatmap = z.infer<typeof Heatmap>;
