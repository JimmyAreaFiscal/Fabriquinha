// A lista única dos tipos de evidência e o schema de cada um (F3 §2): `dados`, as regras dos anexos e as regras cruzadas.
import { z } from "zod";
import type { AgregadoDemanda } from "./agregado_demanda.ts";
import { Plano } from "./demanda.ts";
import { ErroDeRegra } from "./erros.ts";
import type { Id } from "./primitivos.ts";
import { Motivo, Slug, unicoPor } from "./primitivos.ts";
import { Hospedagem } from "./projeto.ts";
import {
  AnaliseSeguranca,
  ArvorePRsCriteriosCustos,
  Arquivos,
  AulaCodigo,
  CaminhoRelativo,
  ComandoRodado,
  ComprovacaoCriterios,
  Criterio,
  CustosRealizados,
  daUltimaConcluida,
  DemonstracaoLimpeza,
  type EsquemaDeEvidencia,
  ExplicacaoFitness,
  HTML_UNICO,
  impactoExigeReversao,
  Linhas,
  LOGS,
  LOGS_OPCIONAIS,
  MensagemPR,
  RelatorioComplexidade,
  Sha,
  Texto,
  TestesEstresse,
  vereditoDe,
} from "./schemas.ts";

/** Os tipos de evidência de qualquer dono: da demanda, da rodada ou do ticket. */
export const TipoEvidencia = z.enum([
  "comportamento",
  "criterios_aceite",
  "desenho_solucao",
  "prototipo",
  "relatorio_complexidade",
  "relatorio_impactos_arquitetura",
  "execucao_testes",
  "matriz_fitness",
  "relatorio_sonar",
  "arquivos_alterados",
  "explicacao_fitness",
  "comprovacao_criterios",
  "mensagem_pr",
  "aula_codigo",
  "video_demonstracao",
  "relatorio_produtividade",
  "pr_aberto",
  "custos_realizados",
  "plano",
  "testes_estresse",
  "analise_seguranca",
  "arvore_prs_criterios_custos",
  "demonstracao_limpeza",
]);
export type TipoEvidencia = z.infer<typeof TipoEvidencia>;

/** Infere o tipo de `dados` nas regras do schema, que o registro guarda sem ele. */
const tipado = <Dados extends Record<string, unknown>>(schema: EsquemaDeEvidencia<Dados>): EsquemaDeEvidencia => schema;

/** Os nomes de `de`, em ordem, para comparar com os esperados de uma regra cruzada. */
const ordenados = (de: readonly string[]): string => `[${de.toSorted((a, b) => a.localeCompare(b)).join(", ")}]`;

/** Os valores de `campo` de cada item de `lista` nos `dados` das evidências `tipo` que passam no filtro. */
const daEvidencia = (ag: AgregadoDemanda, tipo: TipoEvidencia, lista: string, campo: string, ticket?: Id): string[] =>
  ag.evidencias
    .filter((e) => e.tipo === tipo && (ticket === undefined || e.ticket_id === ticket))
    .flatMap((e) => (e.dados[lista] as Record<string, string>[]).map((item) => String(item[campo])));

/** @testes o teste exaustivo a percorre inteira; a produção a lê por schemaDoTipo */
export const SCHEMA_DA_EVIDENCIA: Record<TipoEvidencia, EsquemaDeEvidencia> = {
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
  // O HTML explica a solução ao Auditor; `dados` guarda o que a máquina confere.
  desenho_solucao: {
    dados: z.object({
      resumo: Texto,
      arquivosPrevistos: z
        .array(
          z.object({
            caminho: CaminhoRelativo,
            acao: z.enum(["criar", "alterar", "remover"]),
            motivo: Motivo,
          }),
        )
        .min(1),
      foraDeEscopo: z.array(z.string().trim().min(1)).default([]),
    }),
    arquivos: HTML_UNICO,
  },
  // Obrigatório só quando a demanda é funcionalidade (catálogo do F1).
  prototipo: {
    dados: z.object({
      descricao: Texto,
      comoExecutar: z.string().trim().max(2000).optional(),
    }),
    arquivos: Arquivos({
      min: 1,
      temClasse: { classes: ["video", "imagem"], mensagem: "protótipo precisa de pelo menos um vídeo ou print" },
    }),
  },
  // O HTML traz as etapas de cada fluxo, do gatilho ao fim, com o mesmo `nome` do JSON.
  relatorio_complexidade: { dados: RelatorioComplexidade, arquivos: HTML_UNICO },
  relatorio_impactos_arquitetura: {
    dados: z.object({
      impacto: z.enum(["baixo", "medio", "alto"]),
      novasDependencias: z.array(z.object({ nome: z.string().trim().min(1), motivo: Motivo })),
      novosAcoplamentos: z.array(
        z.object({ de: z.string().trim().min(1), para: z.string().trim().min(1), motivo: Motivo }),
      ),
      riscos: z.array(z.object({ descricao: Texto, mitigacao: Texto })),
    }),
    arquivos: HTML_UNICO,
  },
  // Produzidas pelos coletores (F3 §6); atende quando cada codigoSaida é 0.
  execucao_testes: tipado({
    dados: z.object({ comandos: z.array(ComandoRodado).min(1) }),
    arquivos: LOGS,
    veredito: ({ comandos }) => vereditoDe(comandos.every((c) => c.codigoSaida === 0)),
  }),
  matriz_fitness: tipado({
    dados: z.object({
      linhas: z.array(z.object({ nome: Slug, descricao: z.string(), ...ComandoRodado.shape })).min(1),
    }),
    arquivos: LOGS,
    veredito: ({ linhas }) => vereditoDe(linhas.every((l) => l.codigoSaida === 0)),
  }),
  // Produzida pela Fabriquinha (F3 §4.3, §6): atende quando nenhuma issue do Sonar está aberta nos arquivos alterados.
  relatorio_sonar: tipado({
    dados: z.object({
      chave_sonarqube: z.string(),
      ceTaskId: z.string(),
      arquivosAnalisados: z.array(z.string()),
      issues: z.array(
        z.object({
          arquivo: z.string(),
          linha: z.number().int().optional(),
          regra: z.string(),
          severidade: z.string(),
          mensagem: z.string(),
        }),
      ),
    }),
    arquivos: Arquivos({ max: 0 }),
    veredito: ({ issues }) => vereditoDe(issues.length === 0),
  }),
  // Produzida pela Fabriquinha antes do pi da revisão (F3 §4.4, §7): o diff da rodada × o desenho aprovado.
  arquivos_alterados: {
    dados: z.object({
      base: Sha,
      head: Sha,
      arquivos: z.array(
        z.object({
          caminho: z.string(),
          status: z.enum(["A", "M", "D", "R"]),
          adicionadas: Linhas,
          removidas: Linhas,
          previsto: z.string().nullable().meta({ description: "o padrão de arquivosPrevistos que casou, ou null" }),
        }),
      ),
      previstosNaoTocados: z.array(z.string()),
    }),
    arquivos: Arquivos({ max: 0 }),
  },
  explicacao_fitness: tipado({
    dados: ExplicacaoFitness,
    arquivos: Arquivos({ max: 0 }),
    cruzar({ explicacoes }, { ag, ticket }) {
      const linhas = daEvidencia(ag, "matriz_fitness", "linhas", "nome", ticket);
      const nomes = explicacoes.map((e) => e.nome);
      if (ordenados(nomes) !== ordenados(linhas)) {
        throw new ErroDeRegra(
          `explicacao_fitness explica ${ordenados(nomes)}, e a matriz_fitness de T-${String(ticket)} tem as linhas ${ordenados(linhas)}`,
          "submeta exatamente uma explicação por linha da matriz",
        );
      }
    },
  }),
  comprovacao_criterios: tipado({
    dados: ComprovacaoCriterios,
    arquivos: Arquivos({ classes: ["video", "imagem"], min: 1 }),
    cruzar({ criterios }, { ag, anexos }) {
      const esperados = daEvidencia(ag, "criterios_aceite", "criterios", "id");
      const ids = criterios.map((c) => c.id);
      if (ordenados(ids) !== ordenados(esperados)) {
        throw new ErroDeRegra(
          `comprovacao_criterios comprova ${ordenados(ids)}, e os critérios de aceite do registro são ${ordenados(esperados)}`,
          "submeta exatamente uma comprovação por critério de aceite",
        );
      }
      const semAnexo = [...new Set(criterios.flatMap((c) => c.arquivos))].filter((nome) => !anexos.includes(nome));
      if (semAnexo.length > 0) {
        throw new ErroDeRegra(
          `comprovacao_criterios cita ${semAnexo.join(", ")}, que não está entre os anexos`,
          "anexe cada arquivo citado com --arquivo <caminho>, com o mesmo nome",
        );
      }
    },
    veredito: ({ criterios }) => vereditoDe(criterios.every((c) => c.atendido)),
  }),
  mensagem_pr: tipado({
    dados: MensagemPR,
    arquivos: Arquivos({ max: 0 }),
    cruzar({ naoPrevistos, reversao }, { ag }) {
      const alterados = (daUltimaConcluida(ag, "revisar_rodada", "arquivos_alterados")?.dados.arquivos ?? []) as {
        caminho: string;
        previsto: string | null;
      }[];
      const esperados = alterados.filter((a) => a.previsto === null).map((a) => a.caminho);
      const citados = naoPrevistos.map((n) => n.caminho);
      if (ordenados(citados) !== ordenados(esperados)) {
        throw new ErroDeRegra(
          `mensagem_pr explica os não previstos ${ordenados(citados)}, e a última revisão concluída tem ${ordenados(esperados)}`,
          "submeta em naoPrevistos exatamente um item por arquivo com previsto null no arquivos_alterados, com o motivo",
        );
      }
      // O relatório de impactos é opcional da própria demanda (registrado pela ferramenta externa), nunca de um ticket.
      const impacto = ag.evidencias.find((e) => e.tipo === "relatorio_impactos_arquitetura")?.dados.impacto;
      if (reversao === undefined && impactoExigeReversao(impacto)) {
        throw new ErroDeRegra(
          `mensagem_pr não tem reversao, e o impacto do desenho aprovado é ${impacto as string}`,
          "descreva em reversao como desfazer a mudança",
        );
      }
    },
  }),
  // O agente não anexa nada: a Fabriquinha gera o HTML da aula na submissão (F3 §5).
  aula_codigo: { dados: AulaCodigo, arquivos: HTML_UNICO },
  video_demonstracao: {
    dados: z.object({ roteiro: Texto }),
    arquivos: Arquivos({ classes: ["video"], min: 1, max: 1 }),
  },
  // Produzidas pela Fabriquinha no encerramento da rodada: a produtividade (produtividade_rodada.ts), que nunca passa
  // por aqui, e o PR com o corpo completo, antes de qualquer condensação (F3 §4.7).
  relatorio_produtividade: { dados: z.record(z.string(), z.unknown()), arquivos: HTML_UNICO },
  pr_aberto: {
    dados: z.object({
      hospedagem: Hospedagem,
      id: z.string(),
      url: z.url(),
      branch: z.string(),
      base: z.string(),
      head: Sha,
      condensado: z.boolean().meta({ description: "true se o corpo publicado passou pela condensação do F3 §4.7" }),
    }),
    arquivos: Arquivos({ classes: ["texto"], min: 1, max: 1 }),
  },
  custos_realizados: tipado({ dados: CustosRealizados, arquivos: Arquivos({ max: 0 }) }),
  // O cruzamento do plano com a demanda congelada é da camada que submete.
  plano: tipado({ dados: Plano, arquivos: Arquivos({ max: 0 }) }),
  testes_estresse: tipado({
    dados: TestesEstresse,
    arquivos: LOGS_OPCIONAIS,
    veredito: ({ cenarios }) => vereditoDe(cenarios.every((c) => c.resultado === "passou")),
  }),
  analise_seguranca: tipado({
    dados: AnaliseSeguranca,
    arquivos: LOGS_OPCIONAIS,
    veredito: ({ achados }) => vereditoDe(achados.every((a) => a.severidade === "baixa" || a.severidade === "media")),
  }),
  arvore_prs_criterios_custos: tipado({ dados: ArvorePRsCriteriosCustos, arquivos: Arquivos({ max: 0 }) }),
  demonstracao_limpeza: tipado({
    dados: DemonstracaoLimpeza,
    arquivos: Arquivos({ max: 0 }),
    veredito: ({ sobras }) => vereditoDe(sobras.length === 0),
  }),
};

export const schemaDoTipo = (tipo: TipoEvidencia): EsquemaDeEvidencia => SCHEMA_DA_EVIDENCIA[tipo];
