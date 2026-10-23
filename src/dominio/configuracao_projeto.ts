// Contrato de configuração de projeto do SDLC (seção 7.1). Convive com `projeto.ts` até a migração validada.
// Modelo e effort aqui só têm formato: o par provedor/modelo é conferido pelo harness, não por catálogo local.
import { z } from "zod";
import { Effort, EtapaTicket, Slug } from "./primitivos.ts";

const Comando = z.string().trim().min(1);
const Texto = z.string().min(1);

/** Relativo à raiz git: sem absoluto POSIX/Windows (`/x`, `\x`, `C:\x`) e sem segmento `..`. */
const CaminhoRelativo = z
  .string()
  .min(1)
  .refine((c) => !/^([/\\]|[A-Za-z]:)/.test(c), "use caminho relativo à raiz git")
  .refine((c) => !c.split(/[/\\]/).includes(".."), "travessia com .. não é permitida");

export const Hospedagem = z.enum(["github", "azure-devops"]);

export const ConfiguracaoEtapaProjeto = z
  .strictObject({
    etapa: EtapaTicket,
    modelo_provedor: Texto.optional(),
    modelo_nome: Texto.optional(),
    effort: Effort.optional(),
  })
  .refine((c) => (c.modelo_provedor === undefined) === (c.modelo_nome === undefined), {
    message: "informe modelo_provedor e modelo_nome juntos ou nenhum",
    path: ["modelo_nome"],
  });

export const ComandoPreparacaoProjeto = z.strictObject({ ordem: z.number().int().positive(), comando: Comando });

export const FitnessFunctionProjeto = z.strictObject({
  nome: Slug,
  comando: Comando,
  descricao: z.string().trim().min(1).max(300),
});

export const LinguagemProjeto = z.strictObject({
  caminho: CaminhoRelativo,
  linguagem: Texto,
  comando_teste: Comando,
});

export const ConfiguracaoE2E = z.strictObject({
  caminho_linguagem: CaminhoRelativo,
  comando_build: Comando,
  comando_execucao: Comando,
  codigo_falha: z.number().int().min(1).max(255),
});

export const GlobE2E = z.strictObject({ caminho_linguagem: CaminhoRelativo, glob: CaminhoRelativo });

const repetido = (chaves: string[]): boolean => new Set(chaves).size !== chaves.length;

export const Projeto = z
  .strictObject({
    nome: Slug,
    branch_base: Texto,
    chave_sonarqube: Texto,
    raiz_git: Texto,
    hospedagem: Hospedagem,
    cursor_commit_humano: Texto.optional(),
    etapas: z.array(ConfiguracaoEtapaProjeto).default([]),
    preparacao: z.array(ComandoPreparacaoProjeto).default([]),
    fitness: z.array(FitnessFunctionProjeto).min(1),
    linguagens: z.array(LinguagemProjeto).min(1),
    e2e: z.array(ConfiguracaoE2E).default([]),
    globs: z.array(GlobE2E).default([]),
  })
  .superRefine((p, ctx) => {
    const erro = (path: string, message: string) => {
      ctx.addIssue({ code: "custom", path: [path], message });
    };
    if (repetido(p.etapas.map((e) => e.etapa))) erro("etapas", "etapa repetida");
    if (repetido(p.preparacao.map((c) => String(c.ordem)))) erro("preparacao", "ordem repetida");
    if (repetido(p.fitness.map((f) => f.nome))) erro("fitness", "nome de fitness function repetido");
    if (repetido(p.linguagens.map((l) => l.caminho))) erro("linguagens", "caminho de linguagem repetido");
    if (repetido(p.e2e.map((e) => e.caminho_linguagem))) erro("e2e", "E2E repetido para o mesmo caminho");
    if (repetido(p.globs.map((g) => JSON.stringify([g.caminho_linguagem, g.glob])))) erro("globs", "glob repetido");

    const caminhos = new Set(p.linguagens.map((l) => l.caminho));
    const comE2E = new Set(p.e2e.map((e) => e.caminho_linguagem));
    if (p.e2e.some((e) => !caminhos.has(e.caminho_linguagem))) erro("e2e", "E2E para linguagem/caminho inexistente");
    if (p.globs.some((g) => !comE2E.has(g.caminho_linguagem))) erro("globs", "glob sem E2E correspondente");
    if ([...comE2E].some((c) => !p.globs.some((g) => g.caminho_linguagem === c)))
      erro("e2e", "E2E exige ao menos um glob");
  });

export type Projeto = z.infer<typeof Projeto>;
