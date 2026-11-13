// I-267.R1, CA-6: uma demanda em cada valor antigo de estado da Demanda e da Rodada (os que não são terminais), montada
// pelos serviços e devolvida ao esquema anterior à migração 38. O banco é aberto de novo (a migração roda) e o agendador
// e os Auditores levam a demanda até `concluida`. O pi e o `gh` são falsos; o git é real.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AUDITOR,
  Endereco,
  decidirGate,
  concluirSessaoAjustes,
  iniciarRevisaoIntegral,
  type EstadoDemanda,
  carregarDemanda,
  configuracao,
} from "../../src/modulos/ciclo_de_vida/publico.ts";
import { registrarCorrecoesSessao } from "../../src/modulos/ciclo_de_vida/processo/nucleo/transicoes/transicoes_rodada.ts";
import { abrirBancoDaFabriquinha } from "../../src/server/composicao/banco_da_fabriquinha.ts";
import { comDemanda } from "../../src/modulos/ciclo_de_vida/processo/armazenamento/agregado_da_demanda.ts";
import { integrarPR } from "../../src/modulos/repositorio/publico.ts";
import { abrirBancoTemporario } from "../../apoio-testes/banco/banco_temporario.ts";
import {
  agregadoNoEstado,
  cadastrarProjetoLoja,
  gravarAgregadoPronto,
  montarAgregadoDemanda,
  montarRodada,
} from "../../apoio-testes/cenarios/cenarios_de_demanda.ts";
import {
  ESTADOS_DA_DEMANDA_EM_ANDAMENTO,
  ESTADOS_DA_RODADA_EM_ANDAMENTO,
  rebaixarParaEsquemaAnterior,
} from "../../apoio-testes/banco/esquema_anterior.ts";
import {
  abrirPortao,
  agente,
  agenteMudo,
  agora,
  aprovarRodada,
  atual,
  demandaEmExecucao,
  despacho,
  despachoComEsperaCurta,
  encerrar,
  fecharPortao,
  pi,
  pisAteAgora,
  planejarDemanda,
  revisaoIntegral,
  revisar,
  rodadaDe,
  rodadaEmEncerramento,
  rodadaEmRevisao,
} from "../apoio-execucao.ts";
import {
  AUTOR,
  base,
  CTX,
  type Cenario,
  ciclo,
  criarCenario,
  demanda,
  demandaAprovada,
  demandaEnviada,
  esperar,
  registrarExterna,
  submeterObrigatorias,
} from "../apoio.ts";
import { ghFalso } from "../falsos.ts";
import { enviarAoDesenvolvimento } from "../../src/server/fluxos/envio_ao_desenvolvimento.ts";
import { decidirGateDaDemanda } from "../../src/server/fluxos/cancelamento_em_cascata.ts";

const gh = ghFalso(base);
const UMA_RODADA_DE_UM_TICKET = [{ tickets: 1 }];

/** Rodada 1 no gate do PR: o encerramento da rodada publicou o PR e o Auditor ainda não decidiu. */
async function rodadaNoGateDoPR(c: Cenario): Promise<string> {
  const id = await rodadaEmEncerramento(c);
  await encerrar(c, id);
  return id;
}

/** Rodada 1 na sessão de ajustes: o Auditor reprovou o PR e a conversa com o pi segue aberta. */
async function rodadaNaSessaoDeAjustes(c: Cenario): Promise<string> {
  const id = await rodadaNoGateDoPR(c);
  fecharPortao();
  pi.roteirizar([{ agente: agenteMudo }]);
  const chamadasAntes = pisAteAgora();
  await decidirGate(
    c.banco,
    "gate_pr",
    Endereco.daRodada(id, 1),
    { resultado: "reprovado", motivo: "o PR mistura duas mudanças" },
    AUDITOR,
  );
  await esperar(() => pisAteAgora() === chamadasAntes + 1, "o pi da conversa receber o prompt");
  abrirPortao();
  return id;
}

/** Revisão integral aberta, mas não conduzida: a demanda espera o agendador em `revisar_demanda`. */
async function demandaNaRevisaoIntegral(c: Cenario): Promise<string> {
  const id = await rodadaNoGateDoPR(c);
  await aprovarRodada(c, id, 1);
  iniciarRevisaoIntegral(c.banco, id);
  return id;
}

/** Demanda em `encerrar_demanda`: a revisão integral foi aprovada e o PR final ainda não saiu. */
async function demandaNoEncerramento(c: Cenario): Promise<string> {
  const id = await rodadaNoGateDoPR(c);
  await aprovarRodada(c, id, 1);
  await revisaoIntegral(c, id, "aprovada");
  return id;
}

/** O que o Auditor e o agendador fazem para tirar a demanda do estado em que está (um passo), até ela concluir. */
async function conduzirAteConcluir(c: Cenario, id: string): Promise<void> {
  const deps = despachoComEsperaCurta();
  for (let passo = 0; passo < 16; passo++) {
    const { demanda: dados, rodadas } = demanda(c, id);
    switch (dados.estado) {
      case "concluida":
        return;
      case "entender_e_desenhar":
        submeterObrigatorias(c, id);
        enviarAoDesenvolvimento(c.banco, id, AUTOR, CTX);
        break;
      case "gate_demanda":
        decidirGateDaDemanda(c.banco, id, { resultado: "aprovado" }, AUDITOR);
        break;
      case "planejar":
        await planejarDemanda(c, id, UMA_RODADA_DE_UM_TICKET);
        break;
      case "gate_planejamento":
        await decidirGate(c.banco, "gate_planejamento", Endereco.daDemanda(id), { resultado: "aprovado" }, AUDITOR);
        break;
      case "em_execucao": {
        const rodada = rodadas.find((r) => r.estado !== "concluida");
        if (rodada === undefined) await revisaoIntegral(c, id, "aprovada");
        else await conduzirRodada(c, id, rodada.rodada_id, rodada.estado);
        break;
      }
      case "revisar_demanda":
        await revisaoIntegral(c, id, "aprovada");
        break;
      case "encerrar_demanda":
        await encerrarDemanda(c, id, deps);
        break;
      default:
        assert.fail(`a demanda ${id} está em ${dados.estado}, de onde este teste não a conduz`);
    }
  }
  assert.fail(`a demanda ${id} não concluiu: está em ${demanda(c, id).demanda.estado}`);
}

async function conduzirRodada(c: Cenario, id: string, rodada: number, estado: string): Promise<void> {
  switch (estado) {
    case "implementar":
      abrirPortao();
      pi.roteirizar([{ agente, uso: null }]);
      await ciclo(c, despacho());
      break;
    case "revisar_rodada":
      await revisar(c, id, { resultado: "aprovado" }, rodada);
      break;
    case "encerrar_rodada":
      await encerrar(c, id, rodada);
      break;
    case "gate_pr":
      await aprovarRodada(c, id, rodada);
      break;
    case "ajustar_resultado": {
      const ref = { demanda_id: id, rodada_id: rodada };
      const { ticket_id } = atual(c, id, "ajustar_resultado", rodada);
      const correcao = { ...ref, ticket_id: 1, titulo: "Separar as mudanças", descricao: "d", arquivos_previstos: [] };
      comDemanda(c.banco, id, (ag) =>
        registrarCorrecoesSessao(ag, { ...ref, ticket_id, correcoes: [correcao] }, AUDITOR, { agora: agora() }),
      );
      await concluirSessaoAjustes(c.banco, ref, AUDITOR); // aguarda o fim da conversa
      break;
    }
    default:
      assert.fail(`a rodada ${String(rodada)} está em ${estado}, de onde este teste não a conduz`);
  }
}

/** O PR final: o ciclo o publica, o humano o integra na plataforma e o ciclo seguinte conclui a demanda. */
async function encerrarDemanda(c: Cenario, id: string, deps: ReturnType<typeof despachoComEsperaCurta>): Promise<void> {
  await ciclo(c, deps);
  await ciclo(c, deps);
  assert.equal(demanda(c, id).encerramento?.aguardando_merge_humano, true);
  await integrarPR({ raiz_git: c.repo, hospedagem: "github" }, String(gh.prs().length));
  await ciclo(c, deps);
}

/** Devolve o banco do cenário ao esquema anterior, confere os valores antigos e abre outro: a migração roda no `abrir`. */
function migrarDoEsquemaAnterior(
  t: Parameters<typeof criarCenario>[0],
  c: Cenario,
  id: string,
  antes: { demanda: string; rodada?: string },
): Cenario {
  rebaixarParaEsquemaAnterior(c.banco);
  assert.equal(c.banco.prepare("SELECT fase FROM demanda WHERE id = ?").get(id)?.fase, antes.demanda);
  if (antes.rodada !== undefined) {
    assert.equal(c.banco.prepare("SELECT fase FROM rodada WHERE demanda_id = ?").get(id)?.fase, antes.rodada);
  }
  // O banco antigo fica aberto: a conversa da sessão de ajustes, ainda viva, grava nele o fim da execução; `fechar` o fecha.
  const banco = abrirBancoDaFabriquinha(c.raiz);
  t.after(() => {
    if (banco.isOpen) banco.close();
  });
  return { ...c, banco, config: configuracao(banco) };
}

const DEMANDAS_ANTES: Record<string, (c: Cenario) => Promise<string>> = {
  registro: (c) => Promise.resolve(registrarExterna(c)),
  aprovacao_demanda: (c) => Promise.resolve(demandaEnviada(c)),
  planejamento: (c) => demandaAprovada(c),
  aprovacao_planejamento: async (c) => {
    const id = await demandaAprovada(c);
    await planejarDemanda(c, id, UMA_RODADA_DE_UM_TICKET);
    return id;
  },
  execucao: (c) => demandaEmExecucao(c, UMA_RODADA_DE_UM_TICKET),
  revisao_demanda: demandaNaRevisaoIntegral,
  encerramento: demandaNoEncerramento,
};

const RODADAS_ANTES: Record<string, (c: Cenario) => Promise<string>> = {
  desenvolvimento: (c) => demandaEmExecucao(c, UMA_RODADA_DE_UM_TICKET),
  revisao: rodadaEmRevisao,
  encerramento: rodadaEmEncerramento,
  aprovacao_pull_request: rodadaNoGateDoPR,
  sessao: rodadaNaSessaoDeAjustes,
};

for (const [antigo, novo] of ESTADOS_DA_DEMANDA_EM_ANDAMENTO) {
  test(`demanda em ${antigo}: migra para ${novo} e chega a concluida`, async (t) => {
    gh.zerar();
    const c = criarCenario(t);
    const preparar = DEMANDAS_ANTES[antigo];
    assert.ok(preparar, `falta montar a demanda em ${antigo}`);
    const id = await preparar(c);
    assert.equal(demanda(c, id).demanda.estado, novo);

    const migrado = migrarDoEsquemaAnterior(t, c, id, { demanda: antigo });
    assert.equal(demanda(migrado, id).demanda.estado, novo);
    await conduzirAteConcluir(migrado, id);
    assert.equal(demanda(migrado, id).demanda.estado, "concluida");
  });
}

for (const [antigo, novo] of ESTADOS_DA_RODADA_EM_ANDAMENTO) {
  test(`rodada em ${antigo}: migra para ${novo} e a demanda chega a concluida`, async (t) => {
    gh.zerar();
    const c = criarCenario(t);
    const preparar = RODADAS_ANTES[antigo];
    assert.ok(preparar, `falta montar a rodada em ${antigo}`);
    const id = await preparar(c);
    assert.equal(rodadaDe(c, id, 1)?.estado, novo);

    const migrado = migrarDoEsquemaAnterior(t, c, id, { demanda: "execucao", rodada: antigo });
    assert.equal(rodadaDe(migrado, id, 1)?.estado, novo);
    await conduzirAteConcluir(migrado, id);
    assert.equal(demanda(migrado, id).demanda.estado, "concluida");
  });
}

test("os cenários de demanda, uma em cada valor antigo de Demanda e de Rodada, voltam iguais depois da migração", (t) => {
  const { raiz, banco, fechar } = abrirBancoTemporario();
  t.after(fechar);
  cadastrarProjetoLoja(banco);
  const demandas = ESTADOS_DA_DEMANDA_EM_ANDAMENTO.map(([antigo, novo], i) => ({
    antigo,
    agregado: agregadoNoEstado(`I-${String(i + 1)}`, novo as EstadoDemanda),
  }));
  const rodadas = ESTADOS_DA_RODADA_EM_ANDAMENTO.map(([antigo, novo], i) => {
    const id = `I-${String(20 + i)}`;
    return { antigo, agregado: montarAgregadoDemanda(id, "em_execucao", { rodadas: [montarRodada(id, 1, novo)] }) };
  });
  const montadas = [...demandas, ...rodadas].map((m) => gravarAgregadoPronto(banco, m.agregado));

  rebaixarParaEsquemaAnterior(banco);
  for (const { antigo, agregado } of demandas) {
    assert.equal(banco.prepare("SELECT fase FROM demanda WHERE id = ?").get(agregado.demanda.id)?.fase, antigo);
  }
  for (const { antigo, agregado } of rodadas) {
    assert.equal(banco.prepare("SELECT fase FROM rodada WHERE demanda_id = ?").get(agregado.demanda.id)?.fase, antigo);
  }
  banco.close();

  const migrado = abrirBancoDaFabriquinha(raiz);
  t.after(() => {
    if (migrado.isOpen) migrado.close();
  });
  for (const antes of montadas) assert.deepEqual(carregarDemanda(migrado, antes.demanda.id), antes, antes.demanda.id);
});
