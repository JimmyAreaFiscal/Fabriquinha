import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import {
  agregadoNoEstado,
  cadastrarProjetoLoja,
  gravarAgregadoPronto,
  INSTANTE_DO_CENARIO,
  montarAgregadoDemanda,
  montarRodada,
  montarTicket,
} from "../../../../../apoio-testes/cenarios_de_demanda.ts";
import { fabricaDeBancosTemporarios } from "../../../../../apoio-testes/banco_temporario.ts";
import { type Ator, type TipoEvidencia, Endereco } from "../../etapas/publico.ts";
import { ErroDeRegra } from "../../../../shared/nucleo/erros.ts";
import type { SubmissaoDeEvidencia } from "../../evidencias/publico.ts";
import { relogioFixo } from "../../../../shared/nucleo/relogio.ts";
import { carregarDemanda } from "../armazenamento/agregado_da_demanda.ts";
import { submeterEvidencia } from "./submissao_de_evidencia.ts";

const abrirBancoTemporario = fabricaDeBancosTemporarios();

const WEBM = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x01, 0x02]);
const AGENTE: Ator = { tipo: "agente", trabalho_id: "e1" };
const EXTERNO = { tipo: "externo", ferramenta: "claude", sessao: "I-1" } as const;
const criterio = { id: "CA-1", dado: "d", quando: "q", entao: "e" };
const definicao = {
  demanda_id: "I-1",
  tipo: "criterios_aceite",
  autor: EXTERNO,
  em: INSTANTE_DO_CENARIO,
  dados: { criterios: [criterio] },
};
const comprovacao = {
  criterios: [{ id: "CA-1", atendido: true, comoVerificado: "v", arquivos: ["tela.webm"] }],
};
const plano = (criterios: string[]) => ({
  demanda_id: "I-1",
  criterios,
  rodadas: [{ demanda_id: "I-1", rodada_id: 1, titulo: "r", e2e: false, criterios, depende: [] }],
  tickets: [
    { demanda_id: "I-1", ticket_id: 1, rodada_id: 1, titulo: "t", descricao: "d", arquivos_previstos: [], depende: [] },
  ],
});

function cenario(agregado: Parameters<typeof gravarAgregadoPronto>[1]) {
  const { raiz, banco } = abrirBancoTemporario();
  cadastrarProjetoLoja(banco);
  gravarAgregadoPronto(banco, agregado);
  const saida = join(raiz, "execucoes", "E-1", "saida");
  mkdirSync(saida, { recursive: true });
  const origens = { worktree: join(raiz, "worktrees"), saida, fora: "da saída", copie: saida };
  const arquivo = (nome: string, conteudo: string | Buffer) => {
    const caminho = join(saida, nome);
    writeFileSync(caminho, conteudo);
    return caminho;
  };
  return { banco, origens, arquivo };
}

const emRevisaoDaRodada = () =>
  montarAgregadoDemanda("I-1", "em_execucao", {
    rodadas: [montarRodada("I-1", 1, "revisar_rodada")],
    tickets: [montarTicket("I-1", 3, "revisar_rodada", { rodada_id: 1, estado: "em_execucao" })],
    criterios_citados: [{ demanda_id: "I-1", rodada_id: 1, criterio_id: "CA-1" }],
    evidencias: [definicao],
  });

const submissaoDaComprovacao = (anexos: string[]): SubmissaoDeEvidencia => ({
  tipo: "comprovacao_criterios",
  dono: Endereco.doTicket("I-1", 3),
  produtor: AGENTE,
  dados: comprovacao,
  anexos,
});

const contagem = (banco: DatabaseSync, tabela: string) =>
  Number(banco.prepare(`SELECT COUNT(*) AS n FROM ${tabela}`).get()?.n);

test("submissão válida com 1 vídeo: aceita, 1 evidência e 1 anexo com o SHA-256", () => {
  const { banco, origens, arquivo } = cenario(emRevisaoDaRodada());
  const antes = contagem(banco, "evidencia_demanda");
  const avaliacao = submeterEvidencia(banco, submissaoDaComprovacao([arquivo("tela.webm", WEBM)]), { origens });
  assert.deepEqual(avaliacao, { resultado: "aceita", dados: comprovacao, veredito: "atende" });
  assert.equal(contagem(banco, "evidencia_demanda") - antes, 1);
  assert.deepEqual(
    banco
      .prepare("SELECT caminho, sha256 FROM arquivo_evidencia")
      .all()
      .map((a) => ({ ...a })),
    [{ caminho: "tela.webm", sha256: createHash("sha256").update(WEBM).digest("hex") }],
  );
});

test("a mesma submissão sem anexo, ou com anexo da classe errada, é recusada e não grava nada", () => {
  const { banco, origens, arquivo } = cenario(emRevisaoDaRodada());
  const sem = submeterEvidencia(banco, submissaoDaComprovacao([]), { origens });
  assert.deepEqual(sem, {
    resultado: "recusada",
    motivo: "comprovacao_criterios precisa de pelo menos 1 arquivo(s), e veio 0 (anexe com --arquivo <caminho>)",
  });
  const texto = arquivo("tela.webm", "isto não é vídeo");
  const classe = submeterEvidencia(banco, submissaoDaComprovacao([texto]), { origens });
  assert.match(
    classe.resultado === "recusada" ? classe.motivo : "",
    /é texto, e comprovacao_criterios aceita só video ou imagem/,
  );
  assert.equal(contagem(banco, "arquivo_evidencia"), 0);
  assert.equal(carregarDemanda(banco, "I-1").evidencias.length, 1);
});

test("a conferência da fronteira roda dentro da transação e, se lançar, nada é gravado", () => {
  const { banco, origens, arquivo } = cenario(emRevisaoDaRodada());
  const execucaoEncerrada = new ErroDeRegra("a execução já terminou", "peça outra");
  assert.throws(
    () =>
      submeterEvidencia(banco, submissaoDaComprovacao([arquivo("tela.webm", WEBM)]), {
        origens,
        conferirAntesDeGravar() {
          throw execucaoEncerrada;
        },
      }),
    execucaoEncerrada,
  );
  assert.equal(contagem(banco, "arquivo_evidencia"), 0);
  assert.equal(carregarDemanda(banco, "I-1").evidencias.length, 1);
});

test("plano válido do agente em planejar: aceita e a demanda vai a gate_planejamento; CA inexistente é recusado", () => {
  const { banco, origens } = cenario({ ...agregadoNoEstado("I-1", "planejar"), evidencias: [definicao] } as never);
  const submissao = (criterios: string[]): SubmissaoDeEvidencia => ({
    tipo: "plano" satisfies TipoEvidencia,
    dono: Endereco.doTicket("I-1", 2),
    produtor: AGENTE,
    dados: plano(criterios),
    anexos: [],
  });
  const recusada = submeterEvidencia(banco, submissao(["CA-99"]), { origens });
  assert.match(
    recusada.resultado === "recusada" ? recusada.motivo : "",
    /cita CA-99, que a definição da demanda I-1 não tem/,
  );
  assert.equal(carregarDemanda(banco, "I-1").demanda.estado, "planejar");
  assert.equal(submeterEvidencia(banco, submissao(["CA-1"]), { origens }).resultado, "aceita");
  const depois = carregarDemanda(banco, "I-1");
  assert.equal(depois.demanda.estado, "gate_planejamento");
  assert.deepEqual(
    depois.evidencias.filter((e) => e.tipo === "plano").map((e) => e.ticket_id),
    [2],
  );
});

test("a evidência aceita leva o instante do relógio", () => {
  const { banco, origens } = cenario({ ...agregadoNoEstado("I-1", "planejar"), evidencias: [definicao] } as never);
  const instante = "2031-05-06T07:08:09.000Z";
  const submissao: SubmissaoDeEvidencia = {
    tipo: "plano",
    dono: Endereco.doTicket("I-1", 2),
    produtor: AGENTE,
    dados: plano(["CA-1"]),
    anexos: [],
  };
  submeterEvidencia(banco, submissao, { origens }, relogioFixo(instante));
  assert.equal(carregarDemanda(banco, "I-1").evidencias.find((e) => e.tipo === "plano")?.em, instante);
});

test("erro que não é de regra na guarda dos anexos sobe", () => {
  const { banco, origens, arquivo } = cenario(emRevisaoDaRodada());
  const naoEPasta = join(arquivo("x.txt", "x"), "tela.webm");
  assert.throws(() => submeterEvidencia(banco, submissaoDaComprovacao([naoEPasta]), { origens }), {
    code: "ENOTDIR",
  });
});
