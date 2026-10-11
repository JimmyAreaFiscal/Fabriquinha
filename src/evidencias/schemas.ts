// Conteúdo de cada tipo de evidência (F3 §3.1, §4): o schema de `dados` e as regras dos arquivos.
import { z } from "zod";
import type { TipoEvidencia } from "../dominio/agregado.ts";
import { ErroDeRegra } from "../dominio/erros.ts";
import { unicoPor } from "../dominio/primitivos.ts";

/** F3 §3.1: a classe vem dos bytes iniciais, nunca da extensão. */
export const Classe = z.enum(["video", "imagem", "html", "texto"]);
export type Classe = z.infer<typeof Classe>;

export interface RegraArquivos {
  readonly classes: readonly Classe[];
  readonly min: number;
  /** Ausente: sem limite de quantidade. */
  readonly max?: number;
}

const Arquivos = ({ classes = Classe.options, min = 0, max }: Partial<RegraArquivos>): RegraArquivos => ({
  classes,
  min,
  ...(max !== undefined && { max }),
});

export interface SchemaEvidencia {
  readonly dados: z.ZodType<Record<string, unknown>>;
  readonly arquivos: RegraArquivos;
}

const Criterio = z.object({
  id: z.string().regex(/^CA-\d+$/),
  dado: z.string().trim().min(1),
  quando: z.string().trim().min(1),
  entao: z.string().trim().min(1),
});

/** Os tipos já implementados; os demais entram com as etapas que os usam. */
const SCHEMAS: Partial<Record<TipoEvidencia, SchemaEvidencia>> = {
  // "vídeo / código do comportamento atual e/ou do problema"
  comportamento: {
    dados: z.object({
      descricao: z.string().trim().min(1).max(2000),
      comoReproduzir: z.array(z.string().trim().min(1)).min(1),
    }),
    arquivos: Arquivos({ classes: ["video", "texto"], min: 1 }),
  },
  criterios_aceite: {
    dados: z.object({
      criterios: z.array(Criterio).min(1).refine(unicoPor("id"), "id de critério repetido"),
    }),
    arquivos: Arquivos({ max: 0 }),
  },
};

export function schemaDe(tipo: TipoEvidencia): SchemaEvidencia {
  const schema = SCHEMAS[tipo];
  if (!schema) {
    throw new ErroDeRegra(
      `a Fabriquinha ainda não valida evidências do tipo ${tipo}`,
      `os tipos aceitos hoje são ${Object.keys(SCHEMAS).join(", ")}`,
    );
  }
  return schema;
}

/** O formato que o agente envia (`fabriquinha evidencia schema <tipo>`): JSON Schema de `dados` e as regras de arquivo. */
export function jsonSchemaDe(tipo: TipoEvidencia): { dados: z.core.JSONSchema.BaseSchema; arquivos: RegraArquivos } {
  const { dados, arquivos } = schemaDe(tipo);
  return { dados: z.toJSONSchema(dados, { io: "input" }), arquivos };
}
