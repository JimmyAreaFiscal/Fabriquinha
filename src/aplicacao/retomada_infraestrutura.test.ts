// Retomada automática do ticket falho por infraestrutura, contra banco real em raiz temporária.
import assert from "node:assert/strict";
import { test } from "node:test";
import { fabricaDeBancosTemporarios } from "../../apoio-testes/banco_temporario.ts";
import type { AgregadoDemanda } from "../nucleo/agregado_demanda.ts";
import { PREFIXO_TERCEIRA_REPROVACAO } from "../nucleo/transicoes_rodada.ts";
import { gravarConfiguracaoProjeto, substituirEtapasDoProjeto } from "../armazenamento/configuracao_projeto.ts";
import { carregarDemanda } from "../armazenamento/demandas.ts";
import { gravarAgregadoPronto } from "../../apoio-testes/cenarios_de_demanda.ts";
import { causaDeInfraestrutura, modeloReserva, retomarFalhasDeInfraestrutura } from "./retomada_infraestrutura.ts";

test("classifica a falha: reinício, cota e transitória são infraestrutura; o resto fica para o ticket ou o Auditor", () => {
  const casos: [string, string | undefined][] = [
    ["serviço reiniciado", "reinicio"],
    ["o agente parou com stopReason error: Claude quota exceeded — rate limit (five_hour)", "cota"],
    ["o agente parou com stopReason error: Codex error: The usage limit has been reached", "cota"],
    ["falha de infraestrutura:\n- o SonarQube em http://x está inacessível", "transitoria"],
    ["gh: HTTP 504: Gateway Timeout", "transitoria"],
    ["o agente parou com stopReason error: overloaded_error", "transitoria"],
    ["tempo limite de 60 min", "transitoria"],
    ["o agente parou com stopReason error: ENOSPC: no space left on device, write", undefined],
    ["npm test saiu com código 1", undefined],
    // Os motivos anexados podem casar COTA/TRANSITORIA, mas a decisão é do Auditor.
    [`${PREFIXO_TERCEIRA_REPROVACAO}\n- tempo limite no teste\n- HTTP 429 simulado`, undefined],
  ];
  for (const [motivo, causa] of casos) assert.equal(causaDeInfraestrutura(motivo), causa, motivo);
});

test("o modelo reserva é o do outro provedor, no mesmo nível; sem modelo ou provedor conhecido, nenhum", () => {
  assert.deepEqual(modeloReserva({ provedor: "claude-bridge", nome: "claude-opus-5-5" }), {
    provedor: "openai-codex",
    nome: "gpt-6.1-sol",
  });
  assert.deepEqual(modeloReserva({ provedor: "anthropic", nome: "claude-sonnet-5-5" }), {
    provedor: "openai-codex",
    nome: "gpt-6-luna",
  });
  assert.deepEqual(modeloReserva({ provedor: "openai-codex", nome: "gpt-6-luna" }), {
    provedor: "claude-bridge",
    nome: "claude-opus-5-5",
  });
  assert.equal(modeloReserva({ provedor: "local", nome: "x" }), undefined);
  assert.equal(modeloReserva(undefined), undefined);
});

const falhouEm = "2026-01-01T00:00:00.000Z";
const minutosDepois = (n: number) => new Date(Date.parse(falhouEm) + n * 60_000);

const abrirBancoTemporario = fabricaDeBancosTemporarios();

function cenario() {
  const { banco } = abrirBancoTemporario();
  banco
    .prepare(
      `INSERT INTO projeto (nome, repo, branch_base, hospedagem, sonar_project_key)
       VALUES ('loja', '/nao/existe', 'main', 'github', 'k')`,
    )
    .run();
  gravarConfiguracaoProjeto(banco, {
    nome: "loja",
    branch_base: "main",
    chave_sonarqube: "k",
    raiz_git: "/nao/existe",
    hospedagem: "github",
    etapas: [],
    fitness: [{ nome: "f", comando: "true", descricao: "d" }],
    linguagens: [{ caminho: ".", linguagem: "ts", comando_teste: "true" }],
  });
  substituirEtapasDoProjeto(banco, "loja", [
    { etapa: "implementar", configuracao_agente: { modelo: { provedor: "claude-bridge", nome: "claude-sonnet-5-5" } } },
  ]);
  const tickets: [string, string, string | undefined, number?][] = [
    ["implementar", "falhou", "serviço reiniciado", 3],
    ["implementar", "falhou", "falha de infraestrutura:\n- o SonarQube está inacessível"],
    ["implementar", "falhou", "Claude quota exceeded"],
    ["revisar_rodada", "falhou", "Claude quota exceeded"],
    ["implementar", "falhou", "HTTP 504", 3],
    ["implementar", "falhou", "ENOSPC: no space left on device"],
    ["implementar", "aberto", undefined],
    ["implementar", "falhou", "HTTP 502"],
  ];
  gravarAgregadoPronto(banco, {
    demanda: {
      id: "I-1",
      projeto: "loja",
      titulo: "t",
      tipo: "funcionalidade",
      descricao: "d",
      fase: "execucao",
      fase_alterada_em: falhouEm,
      criada_por: { tipo: "externo", ferramenta: "claude", sessao: "s1" },
      enviada: true,
      branch: "fabriquinha/I-1",
    },
    rodadas: [
      {
        demanda_id: "I-1",
        rodada_id: 1,
        titulo: "r",
        fase: "desenvolvimento",
        e2e: false,
        branch: "fabriquinha/I-1-1",
      },
    ],
    dependencias_rodada: [],
    criterios_citados: [],
    tickets: tickets.map(([etapa, status, motivo, retomadas], i) => ({
      demanda_id: "I-1",
      ticket_id: i + 1,
      rodada_id: 1,
      etapa,
      status,
      status_alterado_em: falhouEm,
      criado_por: { tipo: "fabriquinha" },
      devolucoes: 1,
      instrucao: "corrija",
      ...(motivo !== undefined && { motivo_falha: motivo }),
      ...(retomadas !== undefined && { retomadas_automaticas: retomadas }),
    })),
    dependencias_ticket: [],
    caminhos_ticket: [],
    decisoes: [],
    evidencias: [],
  } as unknown as AgregadoDemanda);
  // O 8º falha ao gravar: o erro de um ticket não impede os outros.
  banco.exec(`CREATE TRIGGER recusa_oito BEFORE UPDATE ON ticket_demanda WHEN NEW.ticket_id = 8
    BEGIN SELECT RAISE(ABORT, 'recusado'); END`);
  const ticket = (id: number) => carregarDemanda(banco, "I-1").tickets.find((t) => t.ticket_id === id);
  return { banco, ticket };
}

test("retoma o reinício na hora e sem contar; a transitória depois da espera; a cota com o modelo reserva", (t) => {
  const { banco, ticket } = cenario();
  const log = t.mock.method(console, "error", () => undefined);

  assert.deepEqual(retomarFalhasDeInfraestrutura(banco, minutosDepois(1)), ["I-1.T1", "I-1.T3"]);
  assert.deepEqual(
    [ticket(1)?.status, ticket(1)?.retomadas_automaticas, ticket(1)?.instrucao, ticket(1)?.devolucoes],
    ["aberto", 3, "corrija", 1],
  );
  assert.deepEqual(
    [ticket(3)?.status, ticket(3)?.retomadas_automaticas, ticket(3)?.configuracao_agente?.modelo],
    ["aberto", 1, { provedor: "openai-codex", nome: "gpt-6-luna" }],
  );
  // Sem modelo configurado na etapa não há reserva; no limite, disco cheio e aberto ficam como estão.
  assert.deepEqual(
    [2, 4, 5, 6, 7].map((id) => ticket(id)?.status),
    ["falhou", "falhou", "falhou", "falhou", "aberto"],
  );

  assert.deepEqual(retomarFalhasDeInfraestrutura(banco, minutosDepois(2)), ["I-1.T2"]);
  assert.deepEqual([ticket(2)?.status, ticket(2)?.retomadas_automaticas], ["aberto", 1]);
  assert.equal(ticket(8)?.status, "falhou");
  assert.match(String(log.mock.calls.at(-1)?.arguments[1]), /recusado/);
});
