// Política de retomada contra banco real: só as causas tipadas decidem, nunca o texto do motivo.
import assert from "node:assert/strict";
import { test } from "node:test";
import { fabricaDeBancosTemporarios } from "../../../../../apoio-testes/banco/banco_temporario.ts";
import {
  gravarAgregadoPronto,
  montarAgregadoDemanda,
  montarRodada,
  montarTicket,
} from "../../../../../apoio-testes/cenarios/cenarios_de_demanda.ts";
import { carregarDemanda, POLITICA_DE_TENTATIVAS } from "../../processo/publico.ts";
import { comDemanda } from "../../processo/armazenamento/agregado_da_demanda.ts";
import {
  Endereco,
  falhaPorServicoReiniciado,
  falhaQueExigeOAuditor,
  type ResultadoDaTentativa,
} from "../../etapas/publico.ts";
import { relogioFixo } from "../../../../shared/nucleo/relogio.ts";
import { retomarFalhasDeInfraestrutura } from "./retomada_infraestrutura.ts";
import type { Modelo } from "../../../sessoes/publico.ts";
import { registrarProjeto } from "../../../../../apoio-testes/demandas_de_teste.ts";

const falhouEm = "2026-01-01T00:00:00.000Z";
const minutosDepois = (minutos: number) => relogioFixo(new Date(Date.parse(falhouEm) + minutos * 60_000).toISOString());
const abrirBancoTemporario = fabricaDeBancosTemporarios();
const tempoLimite: ResultadoDaTentativa = { tipo: "falha_infraestrutura", causa: "tempo_limite", motivo: "aguarde" };
const cota: ResultadoDaTentativa = { tipo: "falha_infraestrutura", causa: "cota", motivo: "aguarde" };
const conjuntoNaoConferido: ResultadoDaTentativa = {
  tipo: "falha_infraestrutura",
  causa: "conjunto_nao_conferido",
  motivo: "o conjunto de sandboxes ainda não foi conferido com o docker",
};
const conferido = () => true;
const naoConferido = () => false;
interface TicketDoCenario {
  resultados: ResultadoDaTentativa[];
  modelo?: Modelo;
  etapa?: "implementar" | "revisar_rodada";
  estado?: "falhou" | "aberto";
}

function cenario(tickets: TicketDoCenario[]) {
  const { banco } = abrirBancoTemporario();
  registrarProjeto(banco, {
    nome: "loja",
    branch_base: "main",
    chave_sonarqube: "k",
    raiz_git: "/nao/existe",
    hospedagem: "github",
    etapas: [
      {
        etapa: "implementar",
        configuracao_agente: { modelo: { provedor: "claude-bridge", nome: "claude-sonnet-5-5" } },
      },
    ],
    verificacoes: {
      fitness: [{ nome: "f", comando: "true", descricao: "d" }],
      linguagens: [{ caminho: ".", linguagem: "ts", comando_teste: "true" }],
    },
  });
  gravarAgregadoPronto(
    banco,
    montarAgregadoDemanda("I-1", "em_execucao", {
      rodadas: [montarRodada("I-1", 1, "implementar")],
      tickets: tickets.map((ticket, indice) =>
        montarTicket("I-1", indice + 1, ticket.etapa ?? "implementar", {
          rodada_id: 1,
          estado: ticket.estado ?? "falhou",
          instrucao: "corrija",
          ...(ticket.modelo && { configuracao_agente: { modelo: ticket.modelo } }),
        }),
      ),
      tentativas: tickets.flatMap((ticket, indice) =>
        ticket.resultados.map((resultado, numero) => ({
          ticket: Endereco.doTicket("I-1", indice + 1),
          numero: numero + 1,
          inicio: falhouEm,
          fim: falhouEm,
          resultado,
        })),
      ),
    }),
  );
  return {
    banco,
    ag: () => carregarDemanda(banco, "I-1"),
    ticket: (numero: number) => carregarDemanda(banco, "I-1").tickets[numero - 1],
  };
}

test("a política resolve a reserva no outro provedor; sem modelo ou provedor conhecido, nenhuma", () => {
  for (const provedor of ["claude-bridge", "anthropic"]) {
    assert.deepEqual(POLITICA_DE_TENTATIVAS.modeloReserva({ provedor, nome: "claude-opus-5-5" }), {
      provedor: "openai-codex",
      nome: "gpt-6.1-sol",
    });
    assert.deepEqual(POLITICA_DE_TENTATIVAS.modeloReserva({ provedor, nome: "claude-sonnet-5-5" }), {
      provedor: "openai-codex",
      nome: "gpt-6-luna",
    });
  }
  assert.deepEqual(POLITICA_DE_TENTATIVAS.modeloReserva({ provedor: "openai-codex", nome: "gpt-6-luna" }), {
    provedor: "claude-bridge",
    nome: "claude-opus-5-5",
  });
  assert.equal(POLITICA_DE_TENTATIVAS.modeloReserva({ provedor: "local", nome: "x" }), undefined);
  assert.equal(POLITICA_DE_TENTATIVAS.modeloReserva(undefined), undefined);
});

test("reinício retoma sem espera nem consumo do limite e preserva a instrução e o histórico", () => {
  const { banco, ag, ticket } = cenario([
    { resultados: [tempoLimite, tempoLimite, tempoLimite, falhaPorServicoReiniciado] },
  ]);
  const antes = ag().tentativas;
  assert.deepEqual(retomarFalhasDeInfraestrutura(banco, conferido, minutosDepois(0)), ["I-1.T1"]);
  assert.deepEqual([ticket(1)?.estado, ticket(1)?.instrucao], ["aberto", "corrija"]);
  assert.deepEqual(ag().tentativas, antes);
  comDemanda(banco, "I-1", (agregado) => ({
    ...agregado,
    tickets: agregado.tickets.map((ticket) => ({ ...ticket, estado: "falhou" as const, estado_alterado_em: falhouEm })),
    tentativas: [
      ...agregado.tentativas,
      { ticket: Endereco.doTicket("I-1", 1), numero: 5, inicio: falhouEm, fim: falhouEm, resultado: tempoLimite },
    ],
  }));
  assert.deepEqual(retomarFalhasDeInfraestrutura(banco, conferido, minutosDepois(100)), []);
});

test("tempo limite espera 2, 8 e 32 minutos; a quarta falha bloqueia", () => {
  for (const [numero, espera] of [
    [1, 2],
    [2, 8],
    [3, 32],
  ] as const) {
    const { banco, ticket, ag } = cenario([{ resultados: Array.from({ length: numero }, () => tempoLimite) }]);
    assert.deepEqual(retomarFalhasDeInfraestrutura(banco, conferido, minutosDepois(espera - 0.001)), []);
    assert.equal(ticket(1)?.estado, "falhou");
    assert.deepEqual(retomarFalhasDeInfraestrutura(banco, conferido, minutosDepois(espera)), ["I-1.T1"]);
    assert.equal(ticket(1)?.estado, "aberto");
    assert.equal(ag().tentativas.length, numero);
  }
  const { banco, ticket } = cenario([{ resultados: Array.from({ length: 4 }, () => tempoLimite) }]);
  assert.deepEqual(retomarFalhasDeInfraestrutura(banco, conferido, minutosDepois(1000)), []);
  assert.equal(ticket(1)?.estado, "falhou");
});

test("cota troca para a reserva na hora, resolvendo o modelo do ticket ou da etapa", () => {
  for (const provedor of ["claude-bridge", "anthropic", "openai-codex"]) {
    for (const nome of ["claude-opus-5-5", "claude-sonnet-5-5"]) {
      const { banco, ticket } = cenario([{ resultados: [cota], modelo: { provedor, nome } }]);
      assert.deepEqual(retomarFalhasDeInfraestrutura(banco, conferido, minutosDepois(0)), ["I-1.T1"]);
      assert.deepEqual(
        ticket(1)?.configuracao_agente?.modelo,
        POLITICA_DE_TENTATIVAS.modeloReserva({ provedor, nome }),
      );
    }
  }
  const { banco, ticket } = cenario([{ resultados: [cota] }]);
  assert.deepEqual(retomarFalhasDeInfraestrutura(banco, conferido), ["I-1.T1"]);
  assert.deepEqual(ticket(1)?.configuracao_agente?.modelo, { provedor: "openai-codex", nome: "gpt-6-luna" });
});

test("sem modelo resolvido, provedor sem reserva, interrupção, reprovação ou histórico, não retoma", () => {
  const { banco, ag } = cenario([
    { resultados: [cota], etapa: "revisar_rodada" },
    { resultados: [cota], modelo: { provedor: "local", nome: "x" } },
    { resultados: [falhaQueExigeOAuditor("HTTP 504: tempo limite")] },
    { resultados: [{ tipo: "interrompida", por: { tipo: "auditor" }, motivo: "pare" }] },
    { resultados: [{ tipo: "reprovacao", motivo: "Claude quota exceeded" }] },
    { resultados: [] },
    { resultados: [tempoLimite], estado: "aberto" },
  ]);
  const antes = ag();
  assert.deepEqual(retomarFalhasDeInfraestrutura(banco, conferido, minutosDepois(100)), []);
  assert.deepEqual(ag(), antes);
});

test("erro ao retomar um ticket não impede a retomada dos seguintes", (contexto) => {
  const { banco, ticket } = cenario([{ resultados: [tempoLimite] }, { resultados: [tempoLimite] }]);
  banco.exec(`CREATE TRIGGER recusa_primeiro BEFORE UPDATE ON ticket_demanda WHEN NEW.ticket_id = 1
    BEGIN SELECT RAISE(ABORT, 'rejeitado'); END`);
  const log = contexto.mock.method(console, "error", () => undefined);
  assert.deepEqual(retomarFalhasDeInfraestrutura(banco, conferido, minutosDepois(2)), ["I-1.T2"]);
  assert.deepEqual([ticket(1)?.estado, ticket(2)?.estado], ["falhou", "aberto"]);
  assert.match(String(log.mock.calls.at(-1)?.arguments[1]), /rejeitado/);
});

test("a recusa por conjunto não conferido retoma na hora com o conjunto conferido e espera sem ele, sem ler a conferência à toa", () => {
  const { banco, ticket } = cenario([{ resultados: [conjuntoNaoConferido] }]);
  assert.deepEqual(retomarFalhasDeInfraestrutura(banco, naoConferido, minutosDepois(1000)), []);
  assert.equal(ticket(1)?.estado, "falhou");
  assert.deepEqual(retomarFalhasDeInfraestrutura(banco, conferido, minutosDepois(0)), ["I-1.T1"]);
  assert.equal(ticket(1)?.estado, "aberto");

  const outro = cenario([{ resultados: [tempoLimite] }, { resultados: [cota] }]);
  const leituras: string[] = [];
  const lerConferencia = () => !leituras.push("lida");
  assert.deepEqual(retomarFalhasDeInfraestrutura(outro.banco, lerConferencia, minutosDepois(2)), ["I-1.T1", "I-1.T2"]);
  assert.deepEqual(leituras, []);
});

test("quatro recusas seguidas por conjunto não conferido voltam a aberto e a espera das demais é a da primeira falha", () => {
  const quatro = cenario([{ resultados: Array.from({ length: 4 }, () => conjuntoNaoConferido) }]);
  assert.deepEqual(retomarFalhasDeInfraestrutura(quatro.banco, conferido, minutosDepois(0)), ["I-1.T1"]);

  const misto = cenario([{ resultados: [conjuntoNaoConferido, tempoLimite] }]);
  assert.deepEqual(retomarFalhasDeInfraestrutura(misto.banco, conferido, minutosDepois(1.999)), []);
  assert.deepEqual(retomarFalhasDeInfraestrutura(misto.banco, conferido, minutosDepois(2)), ["I-1.T1"]);
});
