// Despacho das demandas (CA-1 a CA-8, CA-15 a CA-17) contra banco real em raiz temporária. O início do `implementar` é
// injetável (nada sobe o pi nem o git); as demais etapas rodam de verdade, com o repositório inexistente (falham ao preparar) ou
// com git real e um pi falso.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { after, type TestContext, test } from "node:test";
import { abrirBancoTemporario } from "../../../../../apoio-testes/banco/banco_temporario.ts";
import { instalarPiFalso } from "../../../../../apoio-testes/falsos/pi_falso.ts";
import { instalarDockerFalso } from "../../../../../apoio-testes/falsos/docker_falso.ts";
import { type AgregadoDemanda, carregarDemanda, type Tentativa } from "../../processo/publico.ts";
import {
  criarSessao,
  iniciarExecucao,
  PACOTE,
  carregarSessoesDoContexto,
  comSessoesDoContexto,
} from "../../../sessoes/publico.ts";
import { gravarAgregadoPronto } from "../../../../../apoio-testes/cenarios/cenarios_de_demanda.ts";
import { falhaPorServicoReiniciado, type ResultadoDaTentativa, Endereco } from "../../etapas/publico.ts";
import { configuracao } from "../armazenamento/configuracao_do_servico.ts";
import { criarRepositorioDeTeste } from "../../../../../apoio-testes/repositorio_de_teste.ts";
import { garantirWorktreeDemanda } from "../../../repositorio/publico.ts";
import { conferirPromptComFoto } from "../../conducao/aplicacao/prompt/fotos_retorno/conferir_foto.ts";
import {
  ConducaoDeImplementar,
  ConducaoDeResolverConflito,
  type DepsDespacho,
  despachoDasEtapas,
} from "../../conducao/publico.ts";
import { cicloDoDespacho, demandasParaDespacho, executarAgora, ultimasRecusas } from "./despacho.ts";
import {
  AmbienteHostLocal,
  inserirAmbienteAlocado,
  ligarGestaoDeAmbientesDoTeste,
} from "../../../../../apoio-testes/falsos/ambiente_falso.ts";
import { ConfiguracaoDoAmbiente } from "../../../../shared/nucleo/configuracao_do_ambiente.ts";
import { relogioFixo } from "../../../../shared/nucleo/relogio.ts";
import { retomarFalhasDeInfraestrutura } from "./retomada_infraestrutura.ts";
import { predecessorasPendentesPelasDependencias } from "../../../../server/fluxos/ciclo_do_servico/despacho_do_trabalho.ts";
import { montarDemandasDoBanco } from "../../../../server/composicao/banco_da_fabriquinha.ts";
import { registrarProjeto, registrarDependencia } from "../../../../../apoio-testes/demandas_de_teste.ts";

const ambiente = new AmbienteHostLocal();

const em = "2026-01-01T00:00:00.000Z";
const temporario = mkdtempSync(join(tmpdir(), "fabriquinha-despacho-"));
process.env.PI_CODING_AGENT_DIR = join(temporario, "pi-agent");
delete process.env.FABRIQUINHA_PORTA;

const piFalso = instalarPiFalso(temporario);

const abertos: DatabaseSync[] = [];
after(() => {
  for (const b of abertos) b.close();
});

interface TicketSpec {
  etapa: string;
  rodada?: number;
  estado?: string;
  id?: number;
  instrucao?: string;
  reprovacoes?: number;
  resultado?: ResultadoDaTentativa;
}
interface DemandaSpec {
  estado?: string;
  /** O estado de cada rodada, na ordem (rodada_id 1, 2...). */
  rodadas?: string[];
  tickets?: TicketSpec[];
}

/** Banco novo; `real` usa o repositório git de verdade (e a worktree da demanda I-2), senão o repositório não existe. */
async function cenario(limite: number, real = false) {
  const c = criarRepositorioDeTeste();
  const { banco } = abrirBancoTemporario(c.raiz);
  abertos.push(banco);
  const repo = real ? c.repo : "/nao/existe";
  registrarProjeto(banco, {
    nome: "loja",
    branch_base: "integracao",
    chave_sonarqube: "k",
    raiz_git: repo,
    hospedagem: "github",
    etapas: [],
    verificacoes: {
      fitness: [{ nome: "f", comando: "true", descricao: "d" }],
      linguagens: [{ caminho: ".", linguagem: "ts", comando_teste: "true" }],
    },
  });
  banco.prepare("UPDATE configuracao SET limite_paralelismo = ?").run(limite);
  if (real) {
    process.env.FABRIQUINHA_PI = piFalso.caminho;
    await garantirWorktreeDemanda(ambiente, c.raiz, c.projeto, "I-2", c.log);
  }
  return { c, banco, config: configuracao(banco) };
}

/** A demanda I-`n`. Os tickets sem `id` recebem 1, 2... pela ordem. */
function demanda(
  banco: DatabaseSync,
  n: number,
  { estado = "em_execucao", rodadas = [], tickets = [] }: DemandaSpec,
): void {
  const id = `I-${String(n)}`;
  gravarAgregadoPronto(banco, {
    demanda: {
      id,
      projeto: "loja",
      titulo: "t",
      tipo: "funcionalidade",
      descricao: "d",
      estado,
      estado_alterado_em: em,
      criada_por: { tipo: "externo", ferramenta: "claude", sessao: "s1" },
      enviada: true,
      branch: `fabriquinha/${id}`,
    },
    rodadas: rodadas.map((f, i) => ({
      demanda_id: id,
      rodada_id: i + 1,
      titulo: `r${String(i + 1)}`,
      estado: f,
      estado_alterado_em: "2026-01-01T00:00:00.000Z",
      e2e: false,
      branch: `fabriquinha/${id}-${String(i + 1)}`,
    })),
    dependencias_rodada: [],
    criterios_citados: [],
    tickets: tickets.map((t, i) => ({
      demanda_id: id,
      ticket_id: t.id ?? i + 1,
      etapa: t.etapa,
      estado: t.estado ?? "aberto",
      estado_alterado_em: em,
      criado_por: { tipo: "fabriquinha" },
      ...(t.instrucao !== undefined && { instrucao: t.instrucao }),
      ...(t.rodada !== undefined && { rodada_id: t.rodada }),
    })),
    tentativas: tickets.flatMap((t, indice): Tentativa[] => {
      const ticket = Endereco.doTicket(id, t.id ?? indice + 1);
      if (t.reprovacoes) {
        assert.ok(t.instrucao);
        const motivo = t.instrucao;
        return Array.from({ length: t.reprovacoes }, (_, numero) => ({
          ticket,
          numero: numero + 1,
          inicio: em,
          fim: em,
          resultado: { tipo: "reprovacao", motivo },
        }));
      }
      if (t.resultado || t.instrucao)
        return [
          {
            ticket,
            numero: 1,
            inicio: em,
            fim: em,
            resultado: t.resultado ?? { tipo: "interrompida", por: { tipo: "auditor" } },
            instrucao: t.instrucao,
          },
        ];
      return [];
    }),
    dependencias_ticket: [],
    caminhos_ticket: [],
    arquivos_previstos_rodada: [],
    arquivos_previstos_demanda: [],
    versoes_plano: [],
    decisoes: [],
    evidencias: [],
  } as unknown as AgregadoDemanda);
}

const implementar = (rodada: number, id?: number): TicketSpec => ({ etapa: "implementar", rodada, id });
const estadoDoTicket = (banco: DatabaseSync, n: number, ticket_id: number) =>
  carregarDemanda(banco, `I-${String(n)}`).tickets.find((t) => t.ticket_id === ticket_id)?.estado;
const aberta = (banco: DatabaseSync, n: number, ticket_id: number) =>
  carregarSessoesDoContexto(banco, { demanda_id: `I-${String(n)}`, ticket_id }).execucoes.filter((e) => e.fim == null)
    .length;
const execucoes = (banco: DatabaseSync, n: number, ticket_id: number) =>
  carregarSessoesDoContexto(banco, { demanda_id: `I-${String(n)}`, ticket_id }).execucoes.length;

type ConduzirFalso = (banco: DatabaseSync, endereco: Endereco) => Promise<void>;
/** Abre sessão e execução no ticket que o Despacho reservou, como a condução do `implementar`, sem subir o pi nem o git. */
const conduzirFalso: ConduzirFalso = (banco, endereco) => {
  const ref = { demanda_id: endereco.demanda_id, ticket_id: Number(endereco.ticket_id) };
  const id = randomUUID();
  const sessao = { ...ref, id: randomUUID(), modo: "autonomo" as const, conversa_referencia: "c" };
  comSessoesDoContexto(banco, ref, (estado) => {
    const sessoes = criarSessao(estado.sessoes, sessao);
    return {
      ...estado,
      sessoes,
      execucoes: iniciarExecucao(sessoes, estado.execucoes, { id, trabalho_id: sessao.id, inicio: em, falha: false }),
    };
  });
  return Promise.resolve();
};
/** Despacho cujo `implementar` e `resolver_conflito` rodam `conduzir` no lugar da condução de verdade. */
const comConducaoFalsa = (conduzir: ConduzirFalso): DepsDespacho =>
  despachoDasEtapas({
    conducoesSubstitutas: (d) => ({
      implementar: new (class extends ConducaoDeImplementar {
        override conduzir = (endereco: Endereco) => conduzir(this.deps.banco, endereco);
      })(d),
      resolver_conflito: new (class extends ConducaoDeResolverConflito {
        override conduzir = (endereco: Endereco) => conduzir(this.deps.banco, endereco);
      })(d),
    }),
  });
const deps = comConducaoFalsa(conduzirFalso);
const silenciar = (t: TestContext) => t.mock.method(console, "error", () => undefined);

test("CA-1: o ciclo reserva o implementar elegível e cria a execução aberta", async () => {
  const { banco, config } = await cenario(3);
  demanda(banco, 2, { rodadas: ["implementar"], tickets: [implementar(1)] });
  await Promise.all(
    cicloDoDespacho(banco, config, deps, predecessorasPendentesPelasDependencias(montarDemandasDoBanco(banco))),
  );
  assert.deepEqual([estadoDoTicket(banco, 2, 1), aberta(banco, 2, 1)], ["em_execucao", 1]);
});

test("o ticket que caiu no reinício do serviço volta sozinho no ciclo seguinte, já em execução", async (t: TestContext) => {
  const { banco, config } = await cenario(3);
  demanda(banco, 2, {
    rodadas: ["implementar"],
    tickets: [{ ...implementar(1), estado: "falhou", resultado: falhaPorServicoReiniciado }],
  });
  const log = t.mock.method(console, "error", () => undefined);
  await Promise.all(
    cicloDoDespacho(banco, config, deps, predecessorasPendentesPelasDependencias(montarDemandasDoBanco(banco))),
  );
  assert.deepEqual([estadoDoTicket(banco, 2, 1), aberta(banco, 2, 1)], ["em_execucao", 1]);
  assert.match(String(log.mock.calls[0]?.arguments[1]), /retomados depois de falha de ambiente: I-2\.T1/);
});

test("CA-2: com o limite global de 2, só dois de três tickets de demandas diferentes entram", async () => {
  const { banco, config } = await cenario(2);
  for (const n of [2, 3, 5]) demanda(banco, n, { rodadas: ["implementar"], tickets: [implementar(1)] });
  await Promise.all(
    cicloDoDespacho(banco, config, deps, predecessorasPendentesPelasDependencias(montarDemandasDoBanco(banco))),
  );
  assert.deepEqual(
    [2, 3, 5].map((n) => estadoDoTicket(banco, n, 1)),
    ["em_execucao", "em_execucao", "aberto"],
  );
});

test("CA-3: com o limite 1, a demanda de menor número leva a vaga", async () => {
  const { banco, config } = await cenario(1);
  for (const n of [5, 3]) demanda(banco, n, { rodadas: ["implementar"], tickets: [implementar(1)] });
  await Promise.all(
    cicloDoDespacho(banco, config, deps, predecessorasPendentesPelasDependencias(montarDemandasDoBanco(banco))),
  );
  assert.deepEqual([estadoDoTicket(banco, 3, 1), estadoDoTicket(banco, 5, 1)], ["em_execucao", "aberto"]);
});

test("ultimasRecusas guarda as recusas do último ciclo: o pronto que passou do limite, com o motivo", async () => {
  const { banco, config } = await cenario(1);
  for (const n of [5, 3]) demanda(banco, n, { rodadas: ["implementar"], tickets: [implementar(1)] });
  await Promise.all(
    cicloDoDespacho(banco, config, deps, predecessorasPendentesPelasDependencias(montarDemandasDoBanco(banco))),
  );
  assert.deepEqual(
    [...ultimasRecusas()].map(([item, motivo]) => [item.toString(), motivo]),
    [["I-5.T1", { tipo: "limite_de_paralelismo", em_uso: 0, limite: 1 }]],
  );
});

test("CA-4: com o limite 1, a rodada 1 leva a vaga antes da rodada 2", async () => {
  const { banco, config } = await cenario(1);
  demanda(banco, 3, { rodadas: ["implementar", "implementar"], tickets: [implementar(2), implementar(1)] });
  await Promise.all(
    cicloDoDespacho(banco, config, deps, predecessorasPendentesPelasDependencias(montarDemandasDoBanco(banco))),
  );
  assert.deepEqual([estadoDoTicket(banco, 3, 2), estadoDoTicket(banco, 3, 1)], ["em_execucao", "aberto"]);
});

test("CA-5: com o limite 1, o ticket de menor número da rodada leva a vaga", async () => {
  const { banco, config } = await cenario(1);
  demanda(banco, 3, { rodadas: ["implementar"], tickets: [implementar(1, 4), implementar(1, 2)] });
  await Promise.all(
    cicloDoDespacho(banco, config, deps, predecessorasPendentesPelasDependencias(montarDemandasDoBanco(banco))),
  );
  assert.deepEqual([estadoDoTicket(banco, 3, 2), estadoDoTicket(banco, 3, 4)], ["em_execucao", "aberto"]);
});

test("CA-6 e CA-16: o planejar com predecessora pendente não é despachado nem executado agora", async () => {
  const { banco, config } = await cenario(3);
  demanda(banco, 4, { rodadas: ["implementar"], tickets: [implementar(1)] });
  demanda(banco, 6, { estado: "planejar", tickets: [{ etapa: "planejar" }] });
  banco.exec("UPDATE demanda SET enviada = 0 WHERE id = 'I-6'"); // a dependência só se registra antes do envio
  registrarDependencia(banco, "I-6", "I-4");
  banco.exec("UPDATE demanda SET enviada = 1 WHERE id = 'I-6'");
  await Promise.all(
    cicloDoDespacho(banco, config, deps, predecessorasPendentesPelasDependencias(montarDemandasDoBanco(banco))),
  );
  assert.deepEqual([estadoDoTicket(banco, 6, 1), execucoes(banco, 6, 1)], ["aberto", 0]);
  const antes = carregarDemanda(banco, "I-6");
  assert.deepEqual(
    executarAgora(
      banco,
      { demanda_id: "I-6", ticket_id: 1 },
      config,
      deps,
      predecessorasPendentesPelasDependencias(montarDemandasDoBanco(banco)),
    ),
    {
      tipo: "dependencia_pendente",
      aguarda: [Endereco.daDemanda("I-4")],
    },
  );
  assert.deepEqual([estadoDoTicket(banco, 6, 1), execucoes(banco, 6, 1)], ["aberto", 0]);
  assert.deepEqual(carregarDemanda(banco, "I-6"), antes); // o ensaio da reserva não grava
});

test("demandasParaDespacho lê planejamento, execução, revisão e encerramento, com as predecessoras pendentes informadas", async () => {
  const { banco } = await cenario(3);
  demanda(banco, 4, {});
  demanda(banco, 6, { estado: "planejar" });
  demanda(banco, 7, { estado: "revisar_demanda" });
  demanda(banco, 8, { estado: "encerrar_demanda" });
  demanda(banco, 9, { estado: "gate_planejamento" });
  demanda(banco, 10, { estado: "entender_e_desenhar" });
  banco.exec("INSERT INTO dependencia_demanda VALUES ('I-6', 'I-4')");
  banco.exec("INSERT INTO dependencia_demanda VALUES ('I-7', 'I-8')");
  banco.exec("INSERT INTO dependencia_demanda VALUES ('I-8', 'I-9')");
  const lidas = demandasParaDespacho(banco, predecessorasPendentesPelasDependencias(montarDemandasDoBanco(banco))).map(
    (d) => [d.agregado.demanda.id, d.predecessoras_pendentes],
  );
  assert.deepEqual(lidas, [
    ["I-4", []],
    ["I-6", ["I-4"]],
    ["I-7", ["I-8"]],
    ["I-8", ["I-9"]],
  ]);
  // A demanda que quem chama não cita está liberada.
  assert.deepEqual(
    demandasParaDespacho(banco, () => new Map()).map((d) => d.predecessoras_pendentes),
    [[], [], [], []],
  );
});

test("CA-7: repositório inexistente não deixa o ticket em execução e o motivo vai ao log", async () => {
  const { c, banco, config } = await cenario(3);
  demanda(banco, 2, { rodadas: ["implementar"], tickets: [implementar(1)] });
  await Promise.all(
    cicloDoDespacho(
      banco,
      config,
      despachoDasEtapas(),
      predecessorasPendentesPelasDependencias(montarDemandasDoBanco(banco)),
    ),
  );
  assert.deepEqual([estadoDoTicket(banco, 2, 1), aberta(banco, 2, 1)], ["falhou", 0]);
  assert.match(readFileSync(join(c.raiz, "log"), "utf8"), /preparação falhou: .*\/nao\/existe/);
});

test("conjunto de sandboxes na capacidade: o ticket falha por infraestrutura com o motivo e a retomada o devolve a aberto depois da espera", async (t) => {
  const { c, banco, config } = await cenario(3);
  banco.prepare("UPDATE projeto SET imagem_do_ambiente = 'alpine' WHERE nome = 'loja'").run();
  instalarDockerFalso(join(temporario, `docker-${randomUUID()}`));
  const servico = {
    raiz: c.raiz,
    porta_da_api: 4999,
    home_do_usuario: c.raiz,
    pacote_do_harness: PACOTE,
    dir_do_harness_do_auditor: c.raiz,
  };
  const configuracao = ConfiguracaoDoAmbiente.parse({ tipo: "container", conjunto: "fixo", capacidade_do_conjunto: 1 });
  await ligarGestaoDeAmbientesDoTeste(t, { banco, configuracao: () => configuracao, servico });
  inserirAmbienteAlocado(banco, {
    id: "amb-ocupado",
    container_id: "c-ocupado",
    imagem: "alpine",
    alocado_para: "I-9",
    criado_em: em,
  });
  demanda(banco, 2, { rodadas: ["implementar"], tickets: [implementar(1)] });

  await Promise.all(
    cicloDoDespacho(
      banco,
      config,
      despachoDasEtapas(),
      predecessorasPendentesPelasDependencias(montarDemandasDoBanco(banco)),
    ),
  );

  const ag = carregarDemanda(banco, "I-2");
  assert.equal(estadoDoTicket(banco, 2, 1), "falhou");
  const resultado = ag.tentativas.at(-1)?.resultado;
  assert.ok(resultado?.tipo === "falha_infraestrutura");
  assert.equal(resultado.causa, "servico_externo_inacessivel");
  assert.match(resultado.motivo, /nenhum sandbox disponível: o conjunto está na capacidade de 1/);
  const falhouEm = Date.parse(String(ag.tickets[0]?.estado_alterado_em));
  const depoisDe = (minutos: number) => relogioFixo(new Date(falhouEm + minutos * 60_000).toISOString());
  assert.deepEqual(retomarFalhasDeInfraestrutura(banco, depoisDe(1)), [], "aguarda a espera da política");
  assert.equal(retomarFalhasDeInfraestrutura(banco, depoisDe(2)).length, 1);
  assert.equal(estadoDoTicket(banco, 2, 1), "aberto");
});

test("CA-8: com as rodadas concluídas o ciclo inicia a revisão integral e o revisar_demanda entra em execução", async () => {
  const { banco, config } = await cenario(3);
  demanda(banco, 3, { rodadas: ["concluida"], tickets: [{ etapa: "implementar", rodada: 1, estado: "concluido" }] });
  const fins = cicloDoDespacho(
    banco,
    config,
    despachoDasEtapas(),
    predecessorasPendentesPelasDependencias(montarDemandasDoBanco(banco)),
  );
  const ag = carregarDemanda(banco, "I-3");
  assert.equal(ag.demanda.estado, "revisar_demanda");
  assert.deepEqual(
    ag.tickets.filter((t) => t.etapa === "revisar_demanda").map((t) => t.estado),
    ["em_execucao"],
  );
  await Promise.all(fins);
});

test("a revisão integral reprovada pelo domínio vai ao log e a demanda segue em execucao", async (t) => {
  const log = silenciar(t);
  const { banco, config } = await cenario(3);
  demanda(banco, 3, { rodadas: ["concluida"], tickets: [{ etapa: "implementar", rodada: 1, estado: "falhou" }] });
  await Promise.all(
    cicloDoDespacho(banco, config, deps, predecessorasPendentesPelasDependencias(montarDemandasDoBanco(banco))),
  );
  assert.equal(carregarDemanda(banco, "I-3").demanda.estado, "em_execucao");
  assert.equal(log.mock.callCount(), 1);
});

test("o planejar sem predecessoras pendentes é reservado e iniciado pelo ciclo", async () => {
  const { banco, config } = await cenario(3);
  demanda(banco, 6, { estado: "planejar", tickets: [{ etapa: "planejar" }] });
  const fins = cicloDoDespacho(
    banco,
    config,
    despachoDasEtapas(),
    predecessorasPendentesPelasDependencias(montarDemandasDoBanco(banco)),
  );
  assert.deepEqual([estadoDoTicket(banco, 6, 1), aberta(banco, 6, 1)], ["em_execucao", 1]);
  await Promise.all(fins);
});

test("o revisar_rodada despachado reserva o ticket e a falha de preparação o leva a falhou", async () => {
  const { banco, config } = await cenario(3);
  demanda(banco, 4, { rodadas: ["revisar_rodada"], tickets: [{ etapa: "revisar_rodada", rodada: 1 }] });
  const fins = cicloDoDespacho(
    banco,
    config,
    despachoDasEtapas(),
    predecessorasPendentesPelasDependencias(montarDemandasDoBanco(banco)),
  );
  assert.equal(estadoDoTicket(banco, 4, 1), "em_execucao");
  await Promise.all(fins);
  assert.equal(estadoDoTicket(banco, 4, 1), "falhou");
});

test("CA-15 e CA-17: executar agora cria uma só execução; a segunda tentativa é reprovada", async () => {
  const { banco, config } = await cenario(3);
  demanda(banco, 2, { rodadas: ["implementar"], tickets: [implementar(1)] });
  const ref = { demanda_id: "I-2", ticket_id: 1 };
  const fim = executarAgora(
    banco,
    ref,
    config,
    deps,
    predecessorasPendentesPelasDependencias(montarDemandasDoBanco(banco)),
  );
  assert.throws(
    () =>
      executarAgora(banco, ref, config, deps, predecessorasPendentesPelasDependencias(montarDemandasDoBanco(banco))),
    /está em_execucao/,
  );
  await fim;
  assert.deepEqual([estadoDoTicket(banco, 2, 1), aberta(banco, 2, 1), execucoes(banco, 2, 1)], ["em_execucao", 1, 1]);
});

test("executar agora recusa demanda fora dos estados lidos, ticket inexistente e limite global ocupado", async () => {
  const { banco, config } = await cenario(1);
  demanda(banco, 2, { rodadas: ["implementar"], tickets: [implementar(1)] });
  demanda(banco, 3, { rodadas: ["implementar"], tickets: [implementar(1)] });
  demanda(banco, 4, { estado: "concluida", tickets: [{ etapa: "encerrar_demanda" }] });
  const agora = (demanda_id: string, ticket_id: number) =>
    executarAgora(
      banco,
      { demanda_id, ticket_id },
      config,
      deps,
      predecessorasPendentesPelasDependencias(montarDemandasDoBanco(banco)),
    );
  assert.throws(() => agora("I-4", 1), /não está em planejamento, execução, revisão da demanda nem encerramento/);
  assert.throws(() => agora("I-2", 9), /não existe/);
  await agora("I-2", 1);
  assert.deepEqual(agora("I-3", 1), { tipo: "limite_de_paralelismo", em_uso: 1, limite: 1 });
  assert.equal(estadoDoTicket(banco, 3, 1), "aberto");
});

test("executar agora não perde a vaga livre para outro pronto de menor número: só o limite cheio de execuções recusa", async () => {
  const { banco, config } = await cenario(1);
  demanda(banco, 2, { rodadas: ["implementar"], tickets: [implementar(1)] });
  demanda(banco, 3, { rodadas: ["implementar"], tickets: [implementar(1)] });
  await executarAgora(
    banco,
    { demanda_id: "I-3", ticket_id: 1 },
    config,
    deps,
    predecessorasPendentesPelasDependencias(montarDemandasDoBanco(banco)),
  );
  assert.deepEqual([estadoDoTicket(banco, 2, 1), estadoDoTicket(banco, 3, 1)], ["aberto", "em_execucao"]);
});

test("CA-2 (4): o ticket retomado por falha de infraestrutura só é despachado se o Despacho o devolve em prontos", async () => {
  const { banco, config } = await cenario(1);
  demanda(banco, 1, { rodadas: ["implementar"], tickets: [{ ...implementar(1), estado: "em_execucao" }] });
  demanda(banco, 2, {
    rodadas: ["implementar"],
    tickets: [{ ...implementar(1), estado: "falhou", resultado: falhaPorServicoReiniciado }],
  });
  await Promise.all(
    cicloDoDespacho(banco, config, deps, predecessorasPendentesPelasDependencias(montarDemandasDoBanco(banco))),
  );
  assert.deepEqual([estadoDoTicket(banco, 2, 1), execucoes(banco, 2, 1)], ["aberto", 0]); // retomado, mas sem vaga
  banco.prepare("UPDATE configuracao SET limite_paralelismo = 2").run();
  await Promise.all(
    cicloDoDespacho(banco, config, deps, predecessorasPendentesPelasDependencias(montarDemandasDoBanco(banco))),
  );
  assert.deepEqual([estadoDoTicket(banco, 2, 1), execucoes(banco, 2, 1)], ["em_execucao", 1]);
});

test("falha síncrona ao iniciar desfaz a reserva e vai ao log; fim rejeitado também só vai ao log", async (t) => {
  const log = silenciar(t);
  const { banco, config } = await cenario(3);
  demanda(banco, 2, { rodadas: ["implementar"], tickets: [implementar(1)] });
  demanda(banco, 3, { rodadas: ["implementar"], tickets: [implementar(1)] });
  const quebrado = comConducaoFalsa((b, endereco) => {
    if (endereco.demanda_id === "I-2") throw new Error("sem sessão");
    return conduzirFalso(b, endereco).then(() => Promise.reject(new Error("pi caiu")));
  });
  await Promise.all(
    cicloDoDespacho(banco, config, quebrado, predecessorasPendentesPelasDependencias(montarDemandasDoBanco(banco))),
  );
  assert.deepEqual([estadoDoTicket(banco, 2, 1), execucoes(banco, 2, 1)], ["aberto", 0]);
  assert.equal(estadoDoTicket(banco, 3, 1), "em_execucao");
  assert.equal(log.mock.callCount(), 2);
});

test("planejar reprovado é retomado antes da seleção, mesmo com o limite 1, e ocupa a vaga", async () => {
  const { banco, config } = await cenario(1);
  demanda(banco, 1, { estado: "planejar", tickets: [{ etapa: "planejar", estado: "em_execucao" }] });
  demanda(banco, 2, { rodadas: ["implementar"], tickets: [implementar(1)] });
  banco.exec(`INSERT INTO decisao_ticket (demanda_id, ticket_id, decisao_id, gate, resultado, motivo, por_tipo, em)
    VALUES ('I-1', 1, 1, 'gate_planejamento', 'reprovado', 'refaça o plano', 'auditor', '${em}')`);
  const fins = cicloDoDespacho(
    banco,
    config,
    deps,
    predecessorasPendentesPelasDependencias(montarDemandasDoBanco(banco)),
  );
  assert.deepEqual([execucoes(banco, 1, 1), estadoDoTicket(banco, 2, 1)], [1, "aberto"]);
  await Promise.all(fins);
  assert.equal(
    cicloDoDespacho(banco, config, deps, predecessorasPendentesPelasDependencias(montarDemandasDoBanco(banco))).length,
    1,
  ); // já retomado: só o implementar entra
});

test("CA-2: planejar reprovado com execução aberta (pi vivo) não é retomado", async () => {
  const { banco, config } = await cenario(1);
  demanda(banco, 1, { estado: "planejar", tickets: [{ etapa: "planejar", estado: "em_execucao" }] });
  banco.exec(`INSERT INTO decisao_ticket (demanda_id, ticket_id, decisao_id, gate, resultado, motivo, por_tipo, em)
    VALUES ('I-1', 1, 1, 'gate_planejamento', 'reprovado', 'refaça o plano', 'auditor', '${em}')`);
  banco.exec("INSERT INTO trabalho_agentico VALUES ('S-1', 'I-1', 1, 'interativo', 'ref')");
  banco.exec(
    `INSERT INTO processo_do_trabalho (id, trabalho_id, inicio, fim, falha) VALUES ('E-1', 'S-1', '${em}', NULL, 0)`,
  );
  for (let i = 0; i < 2; i++)
    assert.equal(
      cicloDoDespacho(banco, config, deps, predecessorasPendentesPelasDependencias(montarDemandasDoBanco(banco)))
        .length,
      0,
    );
  assert.equal(execucoes(banco, 1, 1), 1);
});

test("encerrar_rodada: a falha do agente falha o ticket; sem falha ele segue para a conferência", async (t) => {
  silenciar(t); // a conferência recusa: o agente falso não entrega a documentação
  const { banco, config } = await cenario(3, true);
  demanda(banco, 2, { rodadas: ["encerrar_rodada"], tickets: [{ etapa: "encerrar_rodada", rodada: 1 }] });
  piFalso.roteirizar([{ parada: "error", erro: "limite de uso" }]);
  await Promise.all(
    cicloDoDespacho(
      banco,
      config,
      despachoDasEtapas(),
      predecessorasPendentesPelasDependencias(montarDemandasDoBanco(banco)),
    ),
  );
  assert.equal(estadoDoTicket(banco, 2, 1), "falhou");

  const outro = await cenario(3, true);
  demanda(outro.banco, 2, { rodadas: ["encerrar_rodada"], tickets: [{ etapa: "encerrar_rodada", rodada: 1 }] });
  piFalso.roteirizar([{}]);
  await Promise.all(
    cicloDoDespacho(
      outro.banco,
      outro.config,
      despachoDasEtapas(),
      predecessorasPendentesPelasDependencias(montarDemandasDoBanco(outro.banco)),
    ),
  );
  assert.equal(estadoDoTicket(outro.banco, 2, 1), "falhou"); // conclusão reprovada: não fica preso em execução
});

const encerrar = (estado = "aberto"): TicketSpec => ({ etapa: "encerrar_demanda", estado });

test("CA-1 e CA-12: o ciclo reserva o encerrar_demanda sem abrir agente; a falha do encerramento falha o ticket", async () => {
  const { banco, config } = await cenario(3);
  demanda(banco, 2, { estado: "encerrar_demanda", rodadas: ["concluida"], tickets: [encerrar()] });
  const fins = cicloDoDespacho(
    banco,
    config,
    despachoDasEtapas(),
    predecessorasPendentesPelasDependencias(montarDemandasDoBanco(banco)),
  );
  assert.deepEqual([estadoDoTicket(banco, 2, 1), execucoes(banco, 2, 1)], ["em_execucao", 0]);
  await Promise.all(fins);
  assert.equal(estadoDoTicket(banco, 2, 1), "falhou");
  assert.equal(carregarDemanda(banco, "I-2").demanda.estado, "encerrar_demanda");
});

test("a recusa do encerramento que não falhou o ticket não o deixa preso em execução", async (t) => {
  silenciar(t);
  const { banco, config } = await cenario(3);
  demanda(banco, 2, { estado: "encerrar_demanda", rodadas: ["concluida"], tickets: [encerrar()] });
  banco.exec("DELETE FROM linguagem_projeto;"); // sem a configuração do SDLC
  await Promise.all(
    cicloDoDespacho(
      banco,
      config,
      despachoDasEtapas(),
      predecessorasPendentesPelasDependencias(montarDemandasDoBanco(banco)),
    ),
  );
  assert.equal(estadoDoTicket(banco, 2, 1), "falhou");
});

test("CA-3 e CA-4: executar agora no encerrar_demanda reserva sem agente; com o limite ocupado, recusa", async () => {
  const { banco, config } = await cenario(1);
  demanda(banco, 2, { estado: "encerrar_demanda", rodadas: ["concluida"], tickets: [encerrar()] });
  demanda(banco, 3, { estado: "encerrar_demanda", rodadas: ["concluida"], tickets: [encerrar()] });
  const agora = (n: number) =>
    executarAgora(
      banco,
      { demanda_id: `I-${String(n)}`, ticket_id: 1 },
      config,
      despachoDasEtapas(),
      predecessorasPendentesPelasDependencias(montarDemandasDoBanco(banco)),
    );
  const fim = agora(2);
  assert.deepEqual([estadoDoTicket(banco, 2, 1), execucoes(banco, 2, 1)], ["em_execucao", 0]);
  assert.deepEqual(agora(3), { tipo: "limite_de_paralelismo", em_uso: 1, limite: 1 });
  assert.equal(estadoDoTicket(banco, 3, 1), "aberto");
  await fim;
});

test("CA-5: o encerrar_demanda em execução ocupa a vaga do limite 1", async () => {
  const { banco, config } = await cenario(1);
  demanda(banco, 2, { estado: "encerrar_demanda", rodadas: ["concluida"], tickets: [encerrar("em_execucao")] });
  demanda(banco, 3, { rodadas: ["implementar"], tickets: [implementar(1)] });
  await Promise.all(
    cicloDoDespacho(banco, config, deps, predecessorasPendentesPelasDependencias(montarDemandasDoBanco(banco))),
  );
  assert.equal(estadoDoTicket(banco, 3, 1), "aberto");
});

test("CA-7 e CA-10: o resolver_conflito aberto é reservado com execução aberta; o encerrar_demanda seguinte entra sozinho", async () => {
  const { banco, config } = await cenario(3);
  demanda(banco, 2, {
    estado: "encerrar_demanda",
    rodadas: ["concluida"],
    tickets: [{ etapa: "resolver_conflito" }, encerrar()],
  });
  await Promise.all(
    cicloDoDespacho(banco, config, deps, predecessorasPendentesPelasDependencias(montarDemandasDoBanco(banco))),
  );
  assert.deepEqual([estadoDoTicket(banco, 2, 1), aberta(banco, 2, 1)], ["em_execucao", 1]);

  demanda(banco, 3, {
    estado: "encerrar_demanda",
    rodadas: ["concluida"],
    tickets: [{ etapa: "resolver_conflito", estado: "concluido" }, encerrar()],
  });
  const fins = cicloDoDespacho(
    banco,
    config,
    deps,
    predecessorasPendentesPelasDependencias(montarDemandasDoBanco(banco)),
  );
  assert.deepEqual([estadoDoTicket(banco, 3, 2), execucoes(banco, 3, 2)], ["em_execucao", 0]);
  await Promise.all(fins);
});

for (const [caso, ticket] of [
  ["devolucao", { instrucao: "o teste falhou em x.ts", reprovacoes: 1 }],
  ["reabertura", { instrucao: "refaça com atenção a y.ts" }],
] as const) {
  test(`foto do retorno ao agente no despacho: ${caso} do implementar`, async (t) => {
    silenciar(t); // a conclusão recusa: o pi falso não entrega evidência
    const { c, banco, config } = await cenario(3, true);
    demanda(banco, 2, { rodadas: ["implementar"], tickets: [{ ...implementar(1), ...ticket }] });
    piFalso.roteirizar([{}]);
    await Promise.all(
      cicloDoDespacho(
        banco,
        config,
        despachoDasEtapas(),
        predecessorasPendentesPelasDependencias(montarDemandasDoBanco(banco)),
      ),
    );
    conferirPromptComFoto(piFalso.prompts().at(-1)?.prompt ?? "", c.raiz, `despacho_${caso}`);
  });
}

test("o despacho repassa o timeoutMin recebido às conduções", async () => {
  const { banco, config } = await cenario(3);
  demanda(banco, 2, { rodadas: ["implementar"], tickets: [implementar(1)] });
  const limites: (number | undefined)[] = [];
  await Promise.all(
    cicloDoDespacho(
      banco,
      { ...config, timeoutMin: 0.5 },
      despachoDasEtapas({
        conducoesSubstitutas: (d) => ({
          implementar: new (class extends ConducaoDeImplementar {
            override conduzir = () => {
              limites.push(this.deps.limiteMin);
              return Promise.resolve();
            };
          })(d),
        }),
      }),
      predecessorasPendentesPelasDependencias(montarDemandasDoBanco(banco)),
    ),
  );
  assert.deepEqual(limites, [0.5]);
});
