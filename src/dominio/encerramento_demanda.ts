// Progresso do encerramento final da demanda (comparacao-sdlc-implementacao.md §5): decide se um efeito externo se repete.
import { z } from "zod";
import { branchDemanda, DemandaId } from "./demanda.ts";
import { Id, Motivo } from "./primitivos.ts";

const Texto = z.string().trim().min(1);

export const ProgressoEncerramento = z
  .strictObject({
    demanda_id: DemandaId,
    pr: z.strictObject({ numero: z.number().int().positive(), url: Texto }).optional(),
    branch: z.string(),
    // Base configurada do projeto (D02): nunca fixada em `main`.
    base: Texto,
    sha_verificado: Texto.optional(),
    integracao: z.strictObject({ sha: Texto }).optional(),
    limpeza_pendente: z.array(Texto),
    conflito_pendente: z.strictObject({ ticket_id: Id }).optional(),
    falha: z.strictObject({ etapa: z.enum(["check_final", "integracao", "limpeza"]), motivo: Motivo }).optional(),
  })
  .superRefine((p, ctx) => {
    const erro = (message: string) => {
      ctx.addIssue({ code: "custom", message });
    };
    if (p.branch !== branchDemanda(p.demanda_id)) erro(`a branch do encerramento é ${branchDemanda(p.demanda_id)}`);
    if (p.integracao !== undefined && p.pr === undefined) erro("a integração exige o PR final");
    if (p.limpeza_pendente.length > 0 && p.integracao === undefined) erro("a limpeza pendente exige a integração");
    if (new Set(p.limpeza_pendente).size !== p.limpeza_pendente.length) erro("as pendências de limpeza se repetem");
  });

export type ProgressoEncerramento = z.infer<typeof ProgressoEncerramento>;
