// A lista única dos tipos de evidência e o schema de cada um (F3 §2): `dados`, as regras dos anexos e as regras cruzadas.
import { basename } from "node:path";
import { z } from "zod";
import { TipoEvidencia } from "../../../etapas/definicao/tipos_declaraveis.ts";
import type { AgregadoDemanda, Demanda, TicketDemanda } from "../demanda/agregado_demanda.ts";
import type { Ator } from "../../../compartilhado/nucleo/vocabulario_do_sdlc/ator.ts";
import { ErroDeEscopo, ErroDeRegra, existe } from "../../../compartilhado/nucleo/erros.ts";
import { CATALOGO_DE_ETAPAS } from "../../../etapas/catalogo.ts";
import type { ItemCatalogoEtapa } from "../../../etapas/definicao/evidencia_exigida.ts";
import type { Endereco } from "../../../compartilhado/nucleo/vocabulario_do_sdlc/endereco.ts";
import { PlanoProposto } from "../demanda/plano.ts";
import type { Id } from "../../../compartilhado/nucleo/primitivos.ts";
import type { EtapaTicket } from "../../../etapas/catalogo.ts";
import { Motivo, Slug, unicoPor } from "../../../compartilhado/nucleo/primitivos.ts";
import { Hospedagem } from "../../../projeto/nucleo/projeto.ts";
import {
  AnaliseSeguranca,
  ArvorePRsCriteriosCustos,
  Arquivos,
  AulaCodigo,
  CaminhoRelativo,
  ComandoRodado,
  ComprovacaoCriterios,
  Criterio,
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
  type RegraArquivos,
  Sha,
  Texto,
  TestesEstresse,
  type Veredito,
  vereditoDe,
} from "./schemas.ts";

/** A Etapa que exige o tipo de evidência (a primeira do catálogo, quando mais de uma exige). */
const etapaQueExige = (tipo: string): EtapaTicket =>
  existe(
    Object.values(CATALOGO_DE_ETAPAS).find((definicao) => definicao.evidencias.some((item) => item.tipo === tipo)),
    `nenhuma etapa exige a evidência ${tipo}`,
    "declare a evidência na definição da etapa",
  ).nome;

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
    arquivos: LOGS_OPCIONAIS, // o fechamento do ticket anexa o relatório, para a evidência nunca ficar sem log
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
      const alterados = (daUltimaConcluida(ag, etapaQueExige("arquivos_alterados"), "arquivos_alterados")?.dados
        .arquivos ?? []) as {
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
  // Produzidas pela Fabriquinha no encerramento da rodada: a produtividade (produtividade_rodada.ts) e o PR, com o
  // corpo completo, antes de qualquer condensação (F3 §4.7), em `corpoCompleto`; o estado do PR vai para o Espaço.
  relatorio_produtividade: { dados: z.record(z.string(), z.unknown()), arquivos: Arquivos({ max: 0 }) },
  pr_aberto: {
    dados: z.object({
      hospedagem: Hospedagem,
      id: z.string(),
      url: z.url(),
      branch: z.string(),
      base: z.string(),
      head: Sha,
      corpoCompleto: z.string(),
      condensado: z.boolean().meta({ description: "true se o corpo publicado passou pela condensação do F3 §4.7" }),
    }),
    arquivos: Arquivos({ max: 0 }),
  },
  // O cruzamento do plano com a demanda congelada é da camada que submete.
  plano: tipado({ dados: PlanoProposto, arquivos: Arquivos({ max: 0 }) }),
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

/** Recusa quem não é a ferramenta e a sessão autoras da demanda (CA-6). */
export function exigirAutoria(demanda: Demanda, autor: Ator, acao: string): void {
  const { ferramenta, sessao } = demanda.criada_por;
  if (autor.tipo !== "externo" || autor.ferramenta !== ferramenta || autor.sessao !== sessao) {
    throw new ErroDeEscopo(
      `só a ferramenta ${ferramenta} da sessão ${sessao} pode ${acao} a demanda ${demanda.id}`,
      "peça a quem registrou a demanda, na mesma sessão",
    );
  }
}

/** O que se submete à Etapa: `anexos` são os caminhos dos arquivos, que a Etapa ainda não abriu. */
export interface SubmissaoDeEvidencia {
  tipo: TipoEvidencia;
  dono: Endereco;
  produtor: Ator;
  dados: unknown;
  anexos: readonly string[];
}

/** Aceita, com os `dados` já validados pelo schema, ou recusada, com o motivo escrito para quem submeteu. */
export type Avaliacao =
  | { resultado: "aceita"; dados: Record<string, unknown>; veredito?: Veredito }
  | { resultado: "recusada"; motivo: string };

/**
 * Quantidade e nomes dos anexos (F3 §5, passo 4); origem, classe e limite precisam dos bytes e são de `guardarAnexos`.
 * @testes o teste da regra a chama direto; a produção a lê pelo Avaliador
 */
export function conferirQuantidadeENomes(tipo: string, caminhos: readonly string[], regra: RegraArquivos): void {
  if (caminhos.length < regra.min) {
    throw new ErroDeRegra(
      `${tipo} precisa de pelo menos ${String(regra.min)} arquivo(s), e veio ${String(caminhos.length)}`,
      "anexe com --arquivo <caminho>",
    );
  }
  if (regra.max !== undefined && caminhos.length > regra.max) {
    throw new ErroDeRegra(
      `${tipo} aceita no máximo ${String(regra.max)} arquivo(s), e vieram ${String(caminhos.length)}`,
      "submeta sem os excedentes",
    );
  }
  const nomes = caminhos.map((caminho) => basename(caminho));
  const longo = nomes.find((nome) => nome.length > 200);
  if (longo) throw new ErroDeRegra(`o nome ${longo} passa de 200 caracteres`, "renomeie o arquivo");
  const repetido = nomes.find((nome, i) => nomes.indexOf(nome) !== i);
  if (repetido) throw new ErroDeRegra(`dois anexos se chamam ${repetido}`, "renomeie um deles");
}

/**
 * O agregado da demanda como as regras cruzadas e a aula o leem: só os tickets da rodada (e os sem rodada) e, nos
 * critérios de aceite, só os que ela cita. Sem rodada, o agregado inteiro.
 */
export function agregadoDaRodada(ag: AgregadoDemanda, rodada?: number): AgregadoDemanda {
  if (rodada === undefined) return ag;
  const citados = ag.criterios_citados.filter((c) => c.rodada_id === rodada).map((c) => c.criterio_id);
  return {
    ...ag,
    tickets: ag.tickets.filter((t) => t.rodada_id === undefined || t.rodada_id === rodada),
    evidencias: ag.evidencias.map((e) =>
      e.tipo === "criterios_aceite"
        ? { ...e, dados: { criterios: (e.dados.criterios as { id: string }[]).filter((c) => citados.includes(c.id)) } }
        : e,
    ),
  };
}

/**
 * Os tipos obrigatórios da Etapa do ticket que ainda não têm Evidência, na ordem do catálogo. O catálogo vem de quem
 * chama porque `etapas/definicao/evidencia_exigida.ts` já importa este módulo.
 */
export function evidenciasPendentes(
  ag: AgregadoDemanda,
  ticket: Pick<TicketDemanda, "ticket_id" | "etapa">,
  catalogo: readonly ItemCatalogoEtapa[],
): TipoEvidencia[] {
  const daDemanda = catalogo.some((i) => i.etapa === ticket.etapa && i.dono === "demanda");
  const dono = daDemanda ? undefined : ticket.ticket_id;
  const presentes = new Set(
    ag.evidencias.filter((e) => e.rodada_id === undefined && e.ticket_id === dono).map((e) => e.tipo),
  );
  return catalogo.filter((i) => i.etapa === ticket.etapa && i.obrigatoria && !presentes.has(i.tipo)).map((i) => i.tipo);
}

/**
 * Aceita ou recusa uma submissão por um caminho só: catálogo da Etapa (tipo, dono, produtor), schema, anexos e a
 * regra do tipo. `validarPlano` entra pelo construtor porque as transições da demanda já dependem deste módulo.
 */
export class AvaliadorDeEvidencia {
  private readonly catalogo: readonly ItemCatalogoEtapa[];
  private readonly validarPlano: (ag: AgregadoDemanda, entrada: unknown, ator: Ator) => unknown;

  constructor(
    catalogo: readonly ItemCatalogoEtapa[],
    validarPlano: (ag: AgregadoDemanda, entrada: unknown, ator: Ator) => unknown,
  ) {
    this.catalogo = catalogo;
    this.validarPlano = validarPlano;
  }

  avaliar(ag: AgregadoDemanda, submissao: SubmissaoDeEvidencia): Avaliacao {
    try {
      return this.avaliarOuLancarRecusa(ag, submissao);
    } catch (erro) {
      if (erro instanceof ErroDeRegra || erro instanceof ErroDeEscopo) {
        return { resultado: "recusada", motivo: erro.message };
      }
      throw erro;
    }
  }

  private avaliarOuLancarRecusa(ag: AgregadoDemanda, { tipo, dono, produtor, dados, anexos }: SubmissaoDeEvidencia) {
    if (dono.demanda_id !== ag.demanda.id || dono.rodada_id !== undefined) {
      throw new ErroDeRegra(
        `a evidência ${tipo} tem dono errado: ${dono.toString()}`,
        `use a demanda ${ag.demanda.id} ou um ticket dela`,
      );
    }
    const ticket = ag.tickets.find((t) => t.ticket_id === dono.ticket_id);
    if (dono.ticket_id !== undefined && ticket === undefined) {
      throw new ErroDeRegra(`o ticket ${dono.toString()} não existe`, "use um ticket da demanda");
    }
    const onde = ticket ? `T-${String(ticket.ticket_id)} (${ticket.etapa})` : `a demanda ${ag.demanda.id}`;
    // Sem ticket, a evidência é da própria demanda: a da Etapa cujas evidências são dela.
    const daEtapa = this.catalogo.filter((i) => (ticket ? i.etapa === ticket.etapa : i.dono === "demanda"));
    const item = daEtapa.find((i) => i.tipo === tipo);
    if (item === undefined) {
      throw new ErroDeRegra(
        `${onde} não aceita evidência ${tipo}`,
        `use um de ${daEtapa.map((i) => i.tipo).join(", ") || "nenhum tipo"}`,
      );
    }
    if (produtor.tipo !== item.produtor) {
      throw new ErroDeEscopo(
        `a evidência ${tipo} de ${onde} é produzida por ${item.produtor}`,
        `não por ${produtor.tipo}`,
      );
    }
    const schema = SCHEMA_DA_EVIDENCIA[tipo];
    // O caminho do campo sai a partir de `dados`, que é como o agente o vê.
    const lido = z.object({ dados: schema.dados }).safeParse({ dados });
    if (!lido.success) throw new ErroDeRegra(z.prettifyError(lido.error));
    const validos = lido.data.dados;
    conferirQuantidadeENomes(tipo, anexos, schema.arquivos);
    schema.cruzar?.(validos, {
      ag: agregadoDaRodada(ag, ticket?.rodada_id),
      ticket: ticket?.ticket_id,
      anexos: anexos.map((caminho) => basename(caminho)),
    });
    if (tipo === "plano") this.validarPlano(ag, validos, produtor);
    const veredito = schema.veredito?.(validos);
    // Verificação da Fabriquinha que não atende não é evidência; o parecer que não atende é conteúdo e entra.
    if (veredito === "nao_atende" && item.produtor === "fabriquinha" && item.regraAprovacao !== null) {
      throw new ErroDeRegra(
        `a evidência ${tipo} de ${onde} não atende a regra ${item.regraAprovacao}`,
        "corrija o que a verificação apontou",
      );
    }
    // Antes do envio só a autora submete; depois, a definição da demanda fica congelada (§3).
    if (!ag.demanda.enviada) exigirAutoria(ag.demanda, produtor, "submeter evidência da");
    else if (dono.ticket_id === undefined) {
      throw new ErroDeRegra(
        `a demanda ${ag.demanda.id} já foi enviada e a evidência ${tipo} da definição está congelada`,
        "só evidências de ticket entram depois do envio",
      );
    }
    return { resultado: "aceita", dados: validos, veredito } satisfies Avaliacao;
  }
}
