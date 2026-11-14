// O fluxo do despacho: a liberação de Demandas, pela situação administrativa do pedido, é a mesma que o Despacho lia pelo
// estado do processo até o ticket 20 (a que as telas ainda mostram, nos bloqueios das predecessoras); e o ciclo e o
// "Executar agora" a recebem.
import assert from "node:assert/strict";
import { test } from "node:test";
import { abrirBancoTemporario } from "../../../../apoio-testes/banco/banco_temporario.ts";
import {
  agregadoNoEstado,
  cadastrarProjetoLoja,
  gravarAgregadoPronto,
} from "../../../../apoio-testes/cenarios/cenarios_de_demanda.ts";
import {
  Endereco,
  EstadoDemanda,
  type ConducaoDoTicket,
  type DepsDespacho,
  configuracao,
} from "../../../modulos/ciclo_de_vida/publico.ts";
import { bloqueiosDaDemanda, predecessorasDasDemandas } from "../../consultas/demandas/predecessoras.ts";
import { relogioDoSistema } from "../../../shared/nucleo/relogio.ts";
import { despacharAgora, despacharTrabalho, predecessorasPendentesPelasDependencias } from "./despacho_do_trabalho.ts";
import { montarDemandasDoBanco } from "../../composicao/banco_da_fabriquinha.ts";
import { registrarDependencia } from "../../../../apoio-testes/demandas_de_teste.ts";
import { modulosDoCicloDeTeste } from "../../../../apoio-testes/falsos/ambiente_falso.ts";

/** Grava a demanda `id` em `estado` e, antes do envio, as dependências dela. */
function gravarDemandaComPredecessoras(
  banco: ReturnType<typeof abrirBancoTemporario>["banco"],
  id: string,
  estado: EstadoDemanda,
  predecessoras: readonly string[],
): void {
  gravarAgregadoPronto(banco, agregadoNoEstado(id, estado));
  banco.prepare("UPDATE demanda SET enviada = 0 WHERE id = ?").run(id); // a dependência só se registra antes do envio
  for (const predecessora of predecessoras) registrarDependencia(banco, id, predecessora);
  banco.prepare("UPDATE demanda SET enviada = 1 WHERE id = ?").run(id);
}

test("a liberação de Demandas é a de antes: a predecessora em cada estado do processo pende ou libera do mesmo jeito", () => {
  const { banco } = abrirBancoTemporario();
  cadastrarProjetoLoja(banco);
  const predecessoras = EstadoDemanda.options.map((estado, indice) => {
    const id = `I-${String(indice + 1)}`;
    gravarAgregadoPronto(banco, agregadoNoEstado(id, estado));
    return id;
  });
  // Uma dependente de cada predecessora e uma de todas, na ordem em que as arestas foram gravadas.
  const dependentes = predecessoras.map((predecessora, indice) => {
    const id = `I-${String(100 + indice)}`;
    gravarDemandaComPredecessoras(banco, id, "planejar", [predecessora]);
    return id;
  });
  gravarDemandaComPredecessoras(banco, "I-200", "planejar", predecessoras.toReversed());
  const ids = [...dependentes, "I-200", ...predecessoras];
  const liberacaoDeAntes = new Map(
    [...predecessorasDasDemandas(banco, montarDemandasDoBanco(banco), ids)].map(([id, lidas]) => [
      id,
      bloqueiosDaDemanda(lidas).map((predecessora) => predecessora.demanda_id),
    ]),
  );
  assert.deepEqual(predecessorasPendentesPelasDependencias(montarDemandasDoBanco(banco))(ids), liberacaoDeAntes);
  // A comparação não é vazia: concluída e arquivada liberam, as demais pendem.
  const liberadas = dependentes.filter((id) => liberacaoDeAntes.get(id)?.length === 0);
  assert.deepEqual(
    liberadas.map((id) => predecessorasDasDemandas(banco, montarDemandasDoBanco(banco), [id]).get(id)?.[0]?.estado),
    ["concluida", "arquivada"],
  );
  banco.close();
});

test("o ciclo e o Executar agora só despacham o planejar do pedido cujas predecessoras concluíram", async () => {
  const { banco } = abrirBancoTemporario();
  cadastrarProjetoLoja(banco);
  gravarAgregadoPronto(banco, agregadoNoEstado("I-1", "gate_planejamento")); // sem ticket aberto
  gravarDemandaComPredecessoras(banco, "I-2", "planejar", ["I-1"]);
  const conduzidos: string[] = [];
  const conducaoQueAnota: ConducaoDoTicket = {
    conduzir: (endereco) => {
      conduzidos.push(String(endereco));
      return Promise.resolve();
    },
  };
  // Toda Etapa conduz com a mesma condução: só o planejar da I-2 está aberto.
  const conducoes: DepsDespacho = {
    montarConducoes: () =>
      new Proxy({}, { get: () => conducaoQueAnota }) as ReturnType<DepsDespacho["montarConducoes"]>,
  };
  const planejarDaI2 = { demanda_id: "I-2", ticket_id: 2 };
  const c = configuracao(banco);
  await Promise.all(
    despacharTrabalho(modulosDoCicloDeTeste(banco), montarDemandasDoBanco(banco), c, conducoes, relogioDoSistema),
  );
  assert.deepEqual(
    despacharAgora(
      modulosDoCicloDeTeste(banco),
      montarDemandasDoBanco(banco),
      planejarDaI2,
      c,
      conducoes,
      relogioDoSistema,
    ),
    {
      tipo: "dependencia_pendente",
      aguarda: [Endereco.daDemanda("I-1")],
    },
  );
  assert.deepEqual(conduzidos, []);
  banco.prepare("UPDATE demanda SET situacao = 'concluido' WHERE id = 'I-1'").run();
  await despacharAgora(
    modulosDoCicloDeTeste(banco),
    montarDemandasDoBanco(banco),
    planejarDaI2,
    c,
    conducoes,
    relogioDoSistema,
  );
  assert.deepEqual(conduzidos, ["I-2.T2"]);
  banco.close();
});
