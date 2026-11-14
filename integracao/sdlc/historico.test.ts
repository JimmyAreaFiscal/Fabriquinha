// Seção 12 de comparacao-sdlc-implementacao.md, CA-SDLC-23 e 25: cancelamento e arquivamento com dependentes e execução
// em andamento (D08) e a demanda encaminhada de um achado da Avaliação, que saiu (D12, ticket 02). Banco sempre numa raiz
// temporária; git real, pi falso.
import assert from "node:assert/strict";
import { test } from "node:test";
import { AUDITOR, cicloDoDespacho, configuracao } from "../../src/modulos/ciclo_de_vida/publico.ts";
import {
  bloqueiosDaDemanda,
  predecessorasDasDemandas,
  predecessorasDe,
} from "../../src/server/consultas/demandas/predecessoras.ts";
import { consultarDemanda } from "../../src/server/consultas/demandas/demanda.ts";
import { relogioDoSistema } from "../../src/shared/nucleo/relogio.ts";
import * as gestao from "../../src/modulos/ciclo_de_vida/processo/aplicacao/gestao_do_processo.ts";
import {
  abrirPortao,
  agente,
  demandaEmExecucao,
  despacho,
  pi,
  rodadaDe,
  statusDe,
  ticketDe,
} from "../apoio-execucao.ts";
import {
  anexoHtml,
  criarCenario,
  CTX,
  demanda,
  esperar,
  gravarLimiteParalelismo,
  ORIGENS_DOS_ANEXOS,
  registrarExterna,
} from "../apoio.ts";
import { registrarPedidoComProcesso } from "../../src/server/fluxos/registro_do_pedido.ts";
import { enviarAoDesenvolvimento } from "../../src/server/fluxos/envio_ao_desenvolvimento.ts";
import { cancelarDemandaEmCascata, decidirGateDaDemanda } from "../../src/server/fluxos/cancelamento_em_cascata.ts";
import { predecessorasPendentesPelasDependencias } from "../../src/server/fluxos/ciclo_do_servico/despacho_do_trabalho.ts";
import { montarDemandasDoBanco } from "../../src/server/composicao/banco_da_fabriquinha.ts";
import { modulosDoCicloDeTeste } from "../../apoio-testes/falsos/ambiente_falso.ts";
import { carregarSessoesDoContexto } from "../../apoio-testes/sessoes_de_teste.ts";

test("CA-SDLC-23: cancelar interrompe só a demanda e as dependentes abertas, arquivada satisfaz dependência e o histórico fica", async (t) => {
  const c = criarCenario(t);
  gravarLimiteParalelismo(c.banco, 4);
  const config = configuracao(c.banco);
  const a = await demandaEmExecucao(c, [{ tickets: 1 }]);
  const alheia = await demandaEmExecucao(c, [{ tickets: 1 }]);
  // Dependentes de `a`: uma aberta (registro) e outra que já terminou (concluída), que o cancelamento poupa.
  const aberta = registrarExterna(c, [a]);
  const terminada = registrarExterna(c, [a]);
  c.banco.prepare("UPDATE processo_demanda SET estado = 'concluida' WHERE demanda_id = ?").run(terminada);
  c.banco.prepare("UPDATE demanda SET situacao = 'concluido' WHERE id = ?").run(terminada);
  // Dependência de uma demanda que será arquivada.
  const feita = registrarExterna(c);
  const dependeDaFeita = registrarExterna(c, [feita]);
  c.banco.prepare("UPDATE processo_demanda SET estado = 'concluida' WHERE demanda_id = ?").run(feita);
  c.banco.prepare("UPDATE demanda SET situacao = 'concluido' WHERE id = ?").run(feita);

  // As duas demandas em execução têm um agente aberto (o portão fechado o segura).
  pi.roteirizar([{ agente }]);
  const fins = cicloDoDespacho(
    modulosDoCicloDeTeste(c.banco),
    config,
    despacho(),
    predecessorasPendentesPelasDependencias(montarDemandasDoBanco(c.banco)),
  );
  assert.equal(fins.length, 2);
  await esperar(() => pi.prompts().length === 2, "os dois agentes abertos");
  const refA = ticketDe(c, a, 1);
  const refAlheia = ticketDe(c, alheia, 1);
  const antes = demanda(c, a);
  const execucoesAntes = carregarSessoesDoContexto(c.banco, refA).execucoes.length;

  const { canceladas } = cancelarDemandaEmCascata(
    modulosDoCicloDeTeste(c.banco),
    montarDemandasDoBanco(c.banco),
    a,
    AUDITOR,
    CTX,
  );
  assert.deepEqual([...canceladas].sort(), [a, aberta].sort());
  assert.equal(demanda(c, a).demanda.estado, "cancelada");
  assert.equal(demanda(c, aberta).demanda.estado, "cancelada");
  assert.equal(demanda(c, terminada).demanda.estado, "concluida");
  assert.equal(statusDe(c, refA), "cancelado");

  // Libera o agente que sobrou: só a execução da cancelada foi interrompida; a alheia termina normalmente.
  abrirPortao();
  await Promise.all(fins);
  assert.ok(carregarSessoesDoContexto(c.banco, refA).execucoes.every((e) => e.fim));
  assert.equal(carregarSessoesDoContexto(c.banco, refA).execucoes.length, execucoesAntes);
  assert.equal(statusDe(c, refA), "cancelado");
  assert.equal(demanda(c, alheia).demanda.estado, "em_execucao");
  assert.equal(rodadaDe(c, alheia, 1)?.estado, "revisar_rodada");
  assert.notEqual(statusDe(c, refAlheia), "cancelado");
  // O histórico continua no banco: decisões, evidências, rodadas e sessões da cancelada.
  const depois = demanda(c, a);
  assert.deepEqual(depois.decisoes, antes.decisoes);
  assert.deepEqual(depois.evidencias, antes.evidencias);
  assert.deepEqual(depois.rodadas, antes.rodadas);
  assert.equal(carregarSessoesDoContexto(c.banco, refA).sessoes.length > 0, true);
  // A terminada não se cancela de novo.
  assert.throws(
    () =>
      cancelarDemandaEmCascata(modulosDoCicloDeTeste(c.banco), montarDemandasDoBanco(c.banco), terminada, AUDITOR, CTX),
    /já terminou/,
  );

  // Arquivar só vale para concluída, e a arquivada satisfaz a dependência de quem a esperava (D08).
  assert.throws(() => gestao.arquivar(c.banco, a, AUDITOR, CTX), /só no estado concluida/);
  assert.deepEqual(
    bloqueiosDaDemanda(
      predecessorasDe(
        predecessorasDasDemandas(c.banco, montarDemandasDoBanco(c.banco), [dependeDaFeita]),
        dependeDaFeita,
      ),
    ),
    [],
  );
  gestao.arquivar(c.banco, feita, AUDITOR, CTX);
  assert.equal(demanda(c, feita).demanda.estado, "arquivada");
  assert.deepEqual(
    bloqueiosDaDemanda(
      predecessorasDe(
        predecessorasDasDemandas(c.banco, montarDemandasDoBanco(c.banco), [dependeDaFeita]),
        dependeDaFeita,
      ),
    ),
    [],
  );
  assert.equal(demanda(c, dependeDaFeita).demanda.estado, "entender_e_desenhar");
  assert.throws(
    () => cancelarDemandaEmCascata(modulosDoCicloDeTeste(c.banco), montarDemandasDoBanco(c.banco), feita, AUDITOR, CTX),
    /já terminou/,
  );
});

test("CA-SDLC-25 (ticket 02): a demanda encaminhada de um achado antes da retirada da Avaliação abre com a origem e segue o SDLC", async (t) => {
  const c = criarCenario(t);
  const origem = await demandaEmExecucao(c, [{ tickets: 1 }]);
  // O que o encaminhamento do achado gravou quando a Avaliação existia: a avaliação, o achado e a demanda ligada a ele.
  const avaliacao = "11111111-1111-4111-8111-111111111111";
  const autor = { tipo: "externo", ferramenta: "avaliacao", sessao: `${avaliacao}#1` } as const;
  c.banco
    .prepare(
      "INSERT INTO avaliacao (id, projeto, de, ate, pedido, criada_em) VALUES (?, ?, '2026-01-01', '2026-01-31', '', ?)",
    )
    .run(avaliacao, c.projeto, CTX.agora);
  c.banco
    .prepare(
      "INSERT INTO achado_avaliacao (avaliacao_id, achado_id, titulo, descricao, evidencia) VALUES (?, 1, ?, ?, ?)",
    )
    .run(avaliacao, "Achado 1", "desc 1", "ev 1");
  const { demanda: nova } = registrarPedidoComProcesso(
    c.banco,
    montarDemandasDoBanco(c.banco),
    {
      projeto: c.projeto,
      titulo: "Achado 1",
      tipo: "funcionalidade",
      descricao: `desc 1\n\nEvidência: ev 1\n\nOrigem: avaliação ${avaliacao}, achado 1.`,
    },
    autor,
    CTX,
  );
  c.banco.prepare("UPDATE achado_avaliacao SET demanda_id = ? WHERE avaliacao_id = ?").run(nova.id, avaliacao);

  // A página da demanda abre com a origem legível, e a demanda de onde o achado veio segue como estava.
  const pagina = consultarDemanda(c.banco, montarDemandasDoBanco(c.banco), nova.id, relogioDoSistema);
  assert.deepEqual(pagina.origem, { avaliacao, achado: 1, titulo: "Achado 1" });
  assert.deepEqual(pagina.demanda.estado, "entender_e_desenhar");
  assert.deepEqual(demanda(c, nova.id).demanda.criada_por, autor);
  assert.equal(montarDemandasDoBanco(c.banco).pedido(nova.id).origem?.achado_id, 1);
  assert.equal(demanda(c, origem).demanda.estado, "em_execucao");

  // A demanda segue o SDLC normal a partir do registro: a sessão do achado completa, envia e o Auditor decide.
  const submeter = (tipo: string, dados: unknown, arquivos?: gestao.EntradaEvidencia["arquivos"]) =>
    gestao.submeterEvidenciaDaEntradaExterna(
      c.banco,
      nova.id,
      { tipo, dados, arquivos } as gestao.EntradaEvidencia,
      autor,
      ORIGENS_DOS_ANEXOS,
    );
  submeter("criterios_aceite", { criterios: [{ id: "CA-1", dado: "um dado", quando: "quando", entao: "então" }] });
  submeter(
    "desenho_solucao",
    { resumo: "r", arquivosPrevistos: [{ caminho: "src/a.ts", acao: "criar", motivo: "porque" }] },
    [anexoHtml()],
  );
  enviarAoDesenvolvimento(c.banco, montarDemandasDoBanco(c.banco), nova.id, autor, CTX);
  assert.equal(demanda(c, nova.id).demanda.estado, "gate_demanda");
  decidirGateDaDemanda(
    modulosDoCicloDeTeste(c.banco),
    montarDemandasDoBanco(c.banco),
    nova.id,
    { resultado: "aprovado" },
    AUDITOR,
  );
  assert.equal(demanda(c, nova.id).demanda.estado, "planejar");
});
