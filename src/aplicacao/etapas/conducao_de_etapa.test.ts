// A base das conduções: o endereço que ela aceita e a declaração dos passos da condução determinística.
import assert from "node:assert/strict";
import { test } from "node:test";
import { CATALOGO_DE_ETAPAS } from "../../nucleo/etapa.ts";
import { Endereco } from "../../nucleo/item_de_trabalho.ts";
import { anotar } from "../../infra/registro.ts";
import { cenarioRevisao } from "../../../apoio-testes/cenarios_de_demanda.ts";
import { instanteAtual } from "../relogio.ts";
import { condutor } from "../trabalho/condutor.ts";
import { ConducaoDeterministica } from "./conducao_de_etapa.ts";
import { ConducaoDeRevisarDemanda } from "./conducao_de_revisar_demanda.ts";

test("só se conduz o endereço de um ticket", async () => {
  const { banco } = await cenarioRevisao({ integral: true });
  const conducao = new ConducaoDeRevisarDemanda({ banco, relogio: instanteAtual, condutor, registro: anotar });
  await assert.rejects(conducao.conduzir(Endereco.daRodada("I-1", 1)), /I-1.R1 não é um ticket/);
});

test("a condução determinística executa os passos que a concreta declara, na ordem", async () => {
  const executados: string[] = [];
  class ConducaoDeTeste extends ConducaoDeterministica {
    protected readonly passos = ["check_final", "integracao", "limpeza"].map((nome) => ({
      nome,
      executar: (ticket: Endereco) => Promise.resolve(void executados.push(`${nome} ${ticket.toString()}`)),
    }));

    async conduzir(ticket: Endereco): Promise<void> {
      for (const passo of this.passos) await passo.executar(ticket);
    }
  }
  const { banco } = await cenarioRevisao();
  await new ConducaoDeTeste(CATALOGO_DE_ETAPAS.encerrar_demanda, {
    banco,
    relogio: instanteAtual,
    condutor,
    registro: anotar,
  }).conduzir(Endereco.doTicket("I-1", 1));
  assert.deepEqual(executados, ["check_final I-1.T1", "integracao I-1.T1", "limpeza I-1.T1"]);
});
