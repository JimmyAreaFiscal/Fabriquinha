import assert from "node:assert/strict";
import { test } from "node:test";
import {
  INSTANTE_DO_CENARIO,
  montarAgregadoDemanda,
  montarTicket,
} from "../../../../../apoio-testes/cenarios_de_demanda.ts";
import { type Ator, AUDITOR, TipoEvidencia, CATALOGO_ETAPAS, Endereco } from "../../etapas/publico.ts";
import { ErroDeEscopo, ErroDeRegra } from "../../../../shared/nucleo/erros.ts";
import {
  type Avaliacao,
  agregadoDaRodada,
  AvaliadorDeEvidencia,
  evidenciasPendentes,
  exigirAutoria,
  type SubmissaoDeEvidencia,
} from "./avaliacao.ts";
import { conferirQuantidadeENomes, SCHEMA_DA_EVIDENCIA, schemaDoTipo } from "./formatos.ts";
import { validarPlano } from "../../processo/nucleo/transicoes/transicoes_demanda.ts";

test("todo tipo tem entrada em SCHEMA_DA_EVIDENCIA, inclusive os que n\u00e3o tinham schema", () => {
  for (const tipo of TipoEvidencia.options) {
    const schema = SCHEMA_DA_EVIDENCIA[tipo];
    assert.ok(schema.dados, `${tipo} sem schema de dados`);
    assert.ok(schema.arquivos, `${tipo} sem regra de anexos`);
    assert.equal(schemaDoTipo(tipo), schema);
  }
  assert.deepEqual(Object.keys(SCHEMA_DA_EVIDENCIA).toSorted(), TipoEvidencia.options.toSorted());
  assert.ok(TipoEvidencia.options.includes("arvore_prs_criterios_custos"));
  assert.ok(TipoEvidencia.options.includes("demonstracao_limpeza"));
});

test("todo tipo do cat\u00e1logo das etapas \u00e9 um TipoEvidencia", () => {
  for (const { tipo } of CATALOGO_ETAPAS) assert.ok(TipoEvidencia.safeParse(tipo).success, tipo);
});

const comando = { comando: "npm test", codigoSaida: 0, estourou: false, duracaoMs: 1, log: "testes.log" };
const veredito = (tipo: TipoEvidencia, dados: Record<string, unknown>) => schemaDoTipo(tipo).veredito?.(dados);

test("execucao_testes: atende se todo comando saiu com 0", () => {
  assert.equal(veredito("execucao_testes", { comandos: [comando, comando] }), "atende");
  assert.equal(veredito("execucao_testes", { comandos: [comando, { ...comando, codigoSaida: 1 }] }), "nao_atende");
});

test("relatorio_sonar: atende se nenhuma issue est\u00e1 aberta", () => {
  const issue = { arquivo: "a.ts", regra: "x:S1", severidade: "MAJOR", mensagem: "m" };
  assert.equal(veredito("relatorio_sonar", { issues: [] }), "atende");
  assert.equal(veredito("relatorio_sonar", { issues: [issue] }), "nao_atende");
});

test("demonstracao_limpeza: atende se nada sobrou", () => {
  const sobra = { tipo: "branch_remota", alvo: "x" };
  assert.equal(veredito("demonstracao_limpeza", { removidas: [sobra], sobras: [] }), "atende");
  assert.equal(veredito("demonstracao_limpeza", { removidas: [], sobras: [sobra] }), "nao_atende");
});

test("os tipos sem resultado bin\u00e1rio n\u00e3o t\u00eam veredito", () => {
  assert.equal(veredito("arvore_prs_criterios_custos", {}), undefined);
  assert.equal(veredito("pr_aberto", {}), undefined);
});

const criterio = (id: string) => ({ id, dado: "d", quando: "q", entao: "e" });
const CRITERIOS = { criterios: [criterio("CA-1"), criterio("CA-2")] };
const comprovacao = (ids: string[], atendido = true) => ({
  criterios: ids.map((id) => ({ id, atendido, comoVerificado: "v", arquivos: ["cena.png"] })),
});
const sonar = (issues: object[]) => ({ chave_sonarqube: "k", ceTaskId: "c", arquivosAnalisados: [], issues });
const seguranca = (severidade: string) => ({
  aplicavel: true,
  ameacas: [{ descricao: "a", mitigacao: "m" }],
  achados: [{ descricao: "a", severidade, recomendacao: "m" }],
});

const agregado = () =>
  montarAgregadoDemanda("I-1", "em_execucao", {
    tickets: [
      montarTicket("I-1", 2, "implementar", { rodada_id: 1 }),
      montarTicket("I-1", 3, "revisar_rodada", { rodada_id: 1 }),
      montarTicket("I-1", 4, "ajustar_resultado"),
      montarTicket("I-1", 5, "revisar_demanda"),
      montarTicket("I-1", 6, "planejar"),
    ],
    criterios_citados: [{ demanda_id: "I-1", rodada_id: 1, criterio_id: "CA-1" }],
    evidencias: [
      {
        demanda_id: "I-1",
        tipo: "criterios_aceite",
        autor: { tipo: "externo", ferramenta: "claude", sessao: "I-1" },
        em: INSTANTE_DO_CENARIO,
        dados: CRITERIOS,
      },
    ],
  });

const AGENTE: Ator = { tipo: "agente", trabalho_id: "e1" };
const EXTERNO: Ator = { tipo: "externo", ferramenta: "claude", sessao: "I-1" };
const FABRIQUINHA: Ator = { tipo: "fabriquinha" };
const ticket = (n: number) => Endereco.doTicket("I-1", n);

const submissao = (
  tipo: TipoEvidencia,
  dono: Endereco,
  dados: unknown,
  produtor: Ator = AGENTE,
  anexos: string[] = [],
): SubmissaoDeEvidencia => ({ tipo, dono, produtor, dados, anexos });

const motivo = (avaliacao: Avaliacao) => {
  assert.ok(avaliacao.resultado === "recusada");
  return avaliacao.motivo;
};

const avaliador = new AvaliadorDeEvidencia(CATALOGO_ETAPAS, () => undefined);

test("catálogo: tipo fora da etapa, dono errado e produtor errado são recusados com o motivo", () => {
  const ag = agregado();
  assert.equal(
    motivo(avaliador.avaliar(ag, submissao("plano", ticket(2), {}))),
    "T-2 (implementar) não aceita evidência plano (use um de execucao_testes, matriz_fitness, relatorio_sonar)",
  );
  assert.equal(
    motivo(avaliador.avaliar(ag, submissao("plano", ticket(4), {}))),
    "T-4 (ajustar_resultado) não aceita evidência plano (use um de nenhum tipo)",
  );
  assert.match(
    motivo(avaliador.avaliar(ag, submissao("criterios_aceite", Endereco.daDemanda("I-1"), CRITERIOS, AGENTE))),
    /^a evidência criterios_aceite de a demanda I-1 é produzida por externo \(não por agente\)$/,
  );
  assert.equal(
    motivo(avaliador.avaliar(ag, submissao("plano", ticket(6), {}, FABRIQUINHA))),
    "a evidência plano de T-6 (planejar) é produzida por agente (não por fabriquinha)",
  );
  for (const dono of [Endereco.daRodada("I-1", 1), Endereco.doTicket("I-9", 2)]) {
    assert.match(motivo(avaliador.avaliar(ag, submissao("comprovacao_criterios", dono, {}))), /tem dono errado/);
  }
  assert.equal(
    motivo(avaliador.avaliar(ag, submissao("comprovacao_criterios", ticket(99), {}))),
    "o ticket I-1.T99 não existe (use um ticket da demanda)",
  );
});

test("schema: dados inválidos são recusados com o caminho do campo, e os válidos voltam validados", () => {
  const ag = agregado();
  assert.match(
    motivo(
      avaliador.avaliar(ag, submissao("criterios_aceite", Endereco.daDemanda("I-1"), { criterios: "CA-1" }, EXTERNO)),
    ),
    /dados\.criterios/,
  );
  const aceita = avaliador.avaliar(
    naoEnviada(),
    submissao("criterios_aceite", Endereco.daDemanda("I-1"), CRITERIOS, EXTERNO),
  );
  assert.deepEqual(aceita, { resultado: "aceita", dados: CRITERIOS, veredito: undefined });
});

test("anexos: quantidade e nomes", () => {
  const regra = schemaDoTipo("comportamento").arquivos;
  const recusa = (caminhos: string[], tipo = "comportamento") => {
    assert.throws(() => {
      conferirQuantidadeENomes(tipo, caminhos, regra);
    }, ErroDeRegra);
  };
  recusa([]);
  assert.throws(
    () => {
      conferirQuantidadeENomes("criterios_aceite", ["/x/x.txt"], schemaDoTipo("criterios_aceite").arquivos);
    },
    new ErroDeRegra("criterios_aceite aceita no máximo 0 arquivo(s), e vieram 1", "submeta sem os excedentes"),
  );
  assert.throws(
    () => {
      conferirQuantidadeENomes("comportamento", [], regra);
    },
    new ErroDeRegra("comportamento precisa de pelo menos 1 arquivo(s), e veio 0", "anexe com --arquivo <caminho>"),
  );
  assert.throws(
    () => {
      conferirQuantidadeENomes("comportamento", ["/a/passos.txt", "/b/passos.txt"], regra);
    },
    new ErroDeRegra("dois anexos se chamam passos.txt", "renomeie um deles"),
  );
  const longo = "a".repeat(201);
  assert.throws(
    () => {
      conferirQuantidadeENomes("comportamento", [`/a/${longo}`], regra);
    },
    new ErroDeRegra(`o nome ${longo} passa de 200 caracteres`, "renomeie o arquivo"),
  );
  assert.doesNotThrow(() => {
    conferirQuantidadeENomes("comportamento", ["/a/x.txt", "/b/y.txt"], regra);
  });
});

test("regra cruzada: a comprovação da rodada cobre só os critérios que ela cita", () => {
  const ag = agregado();
  const comAnexo = (ids: string[], atendido = true) =>
    submissao("comprovacao_criterios", ticket(3), comprovacao(ids, atendido), AGENTE, ["/saida/cena.png"]);
  assert.match(
    motivo(avaliador.avaliar(ag, comAnexo(["CA-1", "CA-2"]))),
    /comprova \[CA-1, CA-2\], e os critérios de aceite do registro são \[CA-1\]/,
  );
  assert.equal(
    motivo(avaliador.avaliar(ag, submissao("comprovacao_criterios", ticket(3), comprovacao(["CA-1"]), AGENTE))),
    "comprovacao_criterios precisa de pelo menos 1 arquivo(s), e veio 0 (anexe com --arquivo <caminho>)",
  );
  assert.deepEqual(avaliador.avaliar(ag, comAnexo(["CA-1"])), {
    resultado: "aceita",
    dados: comprovacao(["CA-1"]),
    veredito: "atende",
  });
});

test("regra do tipo: verificação da Fabriquinha que não atende é recusada; o parecer que não atende é aceito", () => {
  const ag = agregado();
  const issue = { arquivo: "a.ts", regra: "x:S1", severidade: "MAJOR", mensagem: "m" };
  assert.equal(
    motivo(avaliador.avaliar(ag, submissao("relatorio_sonar", ticket(2), sonar([issue]), FABRIQUINHA))),
    "a evidência relatorio_sonar de T-2 (implementar) não atende a regra sem_issue_aberta_arquivos_alterados (corrija o que a verificação apontou)",
  );
  assert.equal(
    avaliador.avaliar(ag, submissao("relatorio_sonar", ticket(2), sonar([]), FABRIQUINHA)).resultado,
    "aceita",
  );
  const parecer = avaliador.avaliar(ag, submissao("analise_seguranca", ticket(5), seguranca("alta")));
  assert.deepEqual(parecer, { resultado: "aceita", dados: seguranca("alta"), veredito: "nao_atende" });
  const reprovada = avaliador.avaliar(
    ag,
    submissao("comprovacao_criterios", ticket(3), comprovacao(["CA-1"], false), AGENTE, ["/saida/cena.png"]),
  );
  assert.equal(reprovada.resultado === "aceita" && reprovada.veredito, "nao_atende");
});

test("evidenciasPendentes lista só as obrigatórias ausentes da Etapa do ticket, na ordem do catálogo", () => {
  const ag = agregado();
  const doTicket = (tipo: TipoEvidencia, extra: object) => ({
    demanda_id: "I-1",
    tipo,
    autor: FABRIQUINHA,
    em: INSTANTE_DO_CENARIO,
    dados: {},
    ...extra,
  });
  const comEvidencias = {
    ...ag,
    evidencias: [
      ...ag.evidencias,
      doTicket("execucao_testes", { ticket_id: 2 }),
      doTicket("matriz_fitness", { ticket_id: 3 }),
      doTicket("relatorio_sonar", { rodada_id: 1 }),
    ],
  } as typeof ag;
  const implementar = { ticket_id: 2, etapa: "implementar" } as const;
  assert.deepEqual(evidenciasPendentes(ag, implementar, CATALOGO_ETAPAS), [
    "execucao_testes",
    "matriz_fitness",
    "relatorio_sonar",
  ]);
  // A do ticket 3 e a da rodada não são do ticket 2.
  assert.deepEqual(evidenciasPendentes(comEvidencias, implementar, CATALOGO_ETAPAS), [
    "matriz_fitness",
    "relatorio_sonar",
  ]);
  // Na Etapa da demanda o dono é a própria demanda: a evidência do ticket 2 não conta, a dos critérios sim.
  assert.deepEqual(
    evidenciasPendentes(comEvidencias, { ticket_id: 1, etapa: "entender_e_desenhar" }, CATALOGO_ETAPAS),
    ["desenho_solucao"],
  );
  assert.deepEqual(evidenciasPendentes(ag, { ticket_id: 4, etapa: "ajustar_resultado" }, CATALOGO_ETAPAS), []);
});

test("regra do tipo plano: a validação do plano recusa; o erro que não é de regra sobe", () => {
  const ag = agregado();
  const entrada = submissao("plano", ticket(6), { demanda_id: "I-1", criterios: [], rodadas: [], tickets: [] });
  const com = (validar: () => never) => new AvaliadorDeEvidencia(CATALOGO_ETAPAS, validar);
  assert.equal(
    motivo(
      com(() => {
        throw new ErroDeEscopo("só o agente", "peça");
      }).avaliar(ag, entrada),
    ),
    "só o agente (peça)",
  );
  assert.throws(
    () =>
      com(() => {
        throw new TypeError("bug");
      }).avaliar(ag, entrada),
    TypeError,
  );
  assert.equal(avaliador.avaliar(ag, entrada).resultado, "aceita");
});

const OUTRA_SESSAO: Ator = { tipo: "externo", ferramenta: "claude", sessao: "I-2" };
const naoEnviada = () => {
  const ag = agregado();
  return { ...ag, demanda: { ...ag.demanda, enviada: false } };
};
test("exigirAutoria recusa não-externos e externos de outra sessão ou ferramenta", () => {
  const { demanda } = agregado();
  const rejeitados: Ator[] = [
    AUDITOR,
    FABRIQUINHA,
    AGENTE,
    OUTRA_SESSAO,
    { tipo: "externo", ferramenta: "pi", sessao: "I-1" },
  ];
  for (const autor of rejeitados) {
    assert.throws(
      () => {
        exigirAutoria(demanda, autor, "editar");
      },
      {
        name: "ErroDeEscopo",
        message:
          "só a ferramenta claude da sessão I-1 pode editar a demanda I-1 (peça a quem registrou a demanda, na mesma sessão)",
      },
    );
  }
  assert.doesNotThrow(() => {
    exigirAutoria(demanda, EXTERNO, "editar");
  });
});

test("autoria: antes do envio só a ferramenta e a sessão autoras submetem evidência da demanda", () => {
  const ag = naoEnviada();
  const dono = Endereco.daDemanda("I-1");
  assert.equal(
    motivo(avaliador.avaliar(ag, submissao("criterios_aceite", dono, CRITERIOS, OUTRA_SESSAO))),
    "só a ferramenta claude da sessão I-1 pode submeter evidência da a demanda I-1 (peça a quem registrou a demanda, na mesma sessão)",
  );
  assert.equal(avaliador.avaliar(ag, submissao("criterios_aceite", dono, CRITERIOS, EXTERNO)).resultado, "aceita");
});

test("definição congelada: depois do envio a autora também é recusada", () => {
  const ag = agregado();
  const dono = Endereco.daDemanda("I-1");
  assert.equal(
    motivo(avaliador.avaliar(ag, submissao("criterios_aceite", dono, CRITERIOS, EXTERNO))),
    "a demanda I-1 já foi enviada e a evidência criterios_aceite da definição está congelada (só evidências de ticket entram depois do envio)",
  );
  assert.equal(
    avaliador.avaliar(ag, submissao("execucao_testes", ticket(2), { comandos: [] }, FABRIQUINHA)).resultado,
    "recusada",
  );
});

test("plano: só o agente submete, e a validação do plano real recusa fora de planejar", () => {
  const ag = agregado();
  const comValidacaoReal = new AvaliadorDeEvidencia(CATALOGO_ETAPAS, validarPlano);
  const plano = { demanda_id: "I-1", criterios: ["CA-1"], rodadas: [], tickets: [] };
  for (const produtor of [AUDITOR, EXTERNO, FABRIQUINHA]) {
    assert.match(
      motivo(comValidacaoReal.avaliar(ag, submissao("plano", ticket(6), plano, produtor))),
      /é produzida por agente/,
    );
  }
  assert.equal(comValidacaoReal.avaliar(ag, submissao("plano", ticket(6), plano, AGENTE)).resultado, "recusada");
});

test("agregadoDaRodada sem rodada devolve o agregado inteiro", () => {
  const agregado = montarAgregadoDemanda("I-1", "em_execucao");
  assert.equal(agregadoDaRodada(agregado), agregado);
});
