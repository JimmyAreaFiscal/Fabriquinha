// O único Projeto (CONCEITOS.md §13): o repositório, a hospedagem, o SonarQube, a Configuração do Agente por Etapa e as
// Verificações. O formato é validado aqui; repositório, branch e remoto são conferidos antes da gravação (F5 §2).
// Modelo e effort aqui só têm formato: o par provedor/nome é conferido pelo harness, não por catálogo local.
import { isAbsolute } from "node:path";
import { z } from "zod";
import { ConfiguracaoAgente } from "../../execucao/nucleo/configuracao_agente.ts";
import { EtapaTicket, Slug } from "../../compartilhado/nucleo/primitivos.ts";
import { Hospedagem } from "../../repositorio/nucleo/repositorio_do_projeto.ts";

export { Hospedagem };

const MENSAGEM_LINK = "Informe um link http(s) válido, como https://produto.exemplo.com";

const Comando = z.string().trim().min(1);
const Texto = z.string().min(1);
const CaminhoAbsoluto = z.string().refine(isAbsolute, "caminho absoluto");
const NomeDeBranch = Texto;

/** Relativo à raiz git: sem absoluto POSIX/Windows (`/x`, `\x`, `C:\x`) e sem segmento `..`. */
const CaminhoRelativo = z
  .string()
  .min(1)
  .refine((c) => !/^([/\\]|[A-Za-z]:)/.test(c), "use caminho relativo à raiz git")
  .refine((c) => !c.split(/[/\\]/).includes(".."), "travessia com .. não é permitida");

const ConfiguracaoEtapaProjeto = z.strictObject({
  etapa: EtapaTicket,
  configuracao_agente: ConfiguracaoAgente.optional(),
});

const FitnessFunctionProjeto = z.strictObject({
  nome: Slug,
  comando: Comando,
  descricao: z.string().trim().min(1).max(300),
});

const LinguagemProjeto = z.strictObject({
  caminho: CaminhoRelativo,
  linguagem: Texto,
  comando_teste: Comando,
});

const ConfiguracaoE2E = z.strictObject({
  caminho_linguagem: CaminhoRelativo,
  comando_build: Comando,
  comando_execucao: Comando,
  codigo_falha: z.number().int().min(1).max(255),
});

const GlobE2E = z.strictObject({ caminho_linguagem: CaminhoRelativo, glob: CaminhoRelativo });

const repetido = (chaves: string[]): boolean => new Set(chaves).size !== chaves.length;

const Etapas = z
  .array(ConfiguracaoEtapaProjeto)
  .refine((etapas) => !repetido(etapas.map((e) => e.etapa)), "etapa repetida")
  .default([]);

/** Lista obrigatória e não vazia, ou opcional e vazia por padrão. */
const lista = <Item extends z.ZodType>(item: Item, obrigatoria: boolean) =>
  obrigatoria ? z.array(item).min(1) : z.array(item).default([]);

/** Os comandos que rodam, em ordem, ao criar a worktree. */
export const ComandosDePreparacao = z.array(Comando).default([]);

/** `obrigatoria`: a configuração SDLC exige ao menos uma fitness function e uma linguagem; sem ela, vale o projeto recém-cadastrado. */
const verificacoesComSdlc = (obrigatoria: boolean) =>
  z
    .strictObject({
      preparacao: ComandosDePreparacao,
      fitness: lista(FitnessFunctionProjeto, obrigatoria),
      linguagens: lista(LinguagemProjeto, obrigatoria),
      e2e: z.array(ConfiguracaoE2E).default([]),
      globs: z.array(GlobE2E).default([]),
    })
    .superRefine((v, ctx) => {
      const erro = (path: string, message: string) => {
        ctx.addIssue({ code: "custom", path: [path], message });
      };
      if (repetido(v.fitness.map((f) => f.nome))) erro("fitness", "nome de fitness function repetido");
      if (repetido(v.linguagens.map((l) => l.caminho))) erro("linguagens", "caminho de linguagem repetido");
      if (repetido(v.e2e.map((e) => e.caminho_linguagem))) erro("e2e", "E2E repetido para o mesmo caminho");
      if (repetido(v.globs.map((g) => JSON.stringify([g.caminho_linguagem, g.glob])))) erro("globs", "glob repetido");

      const caminhos = new Set(v.linguagens.map((l) => l.caminho));
      const comE2E = new Set(v.e2e.map((e) => e.caminho_linguagem));
      if (v.e2e.some((e) => !caminhos.has(e.caminho_linguagem))) erro("e2e", "E2E para linguagem/caminho inexistente");
      if (v.globs.some((g) => !comE2E.has(g.caminho_linguagem))) erro("globs", "glob sem E2E correspondente");
      if ([...comE2E].some((c) => !v.globs.some((g) => g.caminho_linguagem === c)))
        erro("e2e", "E2E exige ao menos um glob");
    });

const SEM_VERIFICACOES = { preparacao: [], fitness: [], linguagens: [], e2e: [], globs: [] };

const CAMPOS_DO_PROJETO = {
  nome: Slug,
  raiz_git: CaminhoAbsoluto,
  branch_base: NomeDeBranch,
  hospedagem: Hospedagem,
  chave_sonarqube: Texto,
  // O formulário manda "" quando o campo está vazio.
  link_produto: z
    .union([z.literal("").transform(() => undefined), z.url({ protocol: /^https?$/, error: MENSAGEM_LINK })], {
      error: MENSAGEM_LINK,
    })
    .optional(),
  etapas: Etapas,
  // Dockerfile no repositório ou nome de imagem; sem ela o projeto continua no host local.
  imagem_do_ambiente: Texto.optional(),
};

export const Projeto = z.strictObject({
  ...CAMPOS_DO_PROJETO,
  verificacoes: verificacoesComSdlc(false).default(SEM_VERIFICACOES),
});

/** O projeto com a configuração SDLC completa: o que a rota da configuração SDLC grava. */
export const ProjetoConfigurado = z.strictObject({
  ...CAMPOS_DO_PROJETO,
  verificacoes: verificacoesComSdlc(true),
});

export type Projeto = z.infer<typeof Projeto>;
