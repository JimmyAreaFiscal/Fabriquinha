// Apoio dos testes do quadro de demandas: semeia as demandas no banco da instância, sobre o `projeto()` de apoio.ts.
import type { AgregadoDemanda } from "../src/dominio/agregado_demanda.ts";
import { abrir } from "../src/persistencia/banco.ts";
import { criarDemanda } from "../src/persistencia/demandas.ts";

const em = "2026-10-11T12:00:00.000Z";

const ticket = (demanda_id: string, ticket_id: number, etapa: string, rodada_id: number, status: string) => ({
  demanda_id,
  ticket_id,
  etapa,
  status,
  status_alterado_em: em,
  rodada_id,
  devolucoes: 0,
});

const rodada = (demanda_id: string, rodada_id: number, fase: string) => ({
  demanda_id,
  rodada_id,
  titulo: `rodada ${String(rodada_id)}`,
  fase,
  e2e: false,
  branch: `fabriquinha/${demanda_id}-${String(rodada_id)}`,
});

const demanda = (id: string, fase: string, resto: object = {}): AgregadoDemanda =>
  ({
    demanda: {
      id,
      projeto: "loja",
      titulo: `Demanda ${id}`,
      tipo: "funcionalidade",
      descricao: "d",
      fase,
      fase_alterada_em: em,
      origem_ferramenta: "claude",
      origem_sessao: id,
      enviada: true,
      branch: `fabriquinha/${id}`,
    },
    tickets: [],
    decisoes: [],
    evidencias: [],
    rodadas: [],
    dependencias_rodada: [],
    criterios_citados: [],
    dependencias_ticket: [],
    caminhos_ticket: [],
    ...resto,
  }) as unknown as AgregadoDemanda;

/**
 * I-206 em execução: R1 aguardando o PR 7 (aberto) e R2 sem PR, com o T3 em execução. I-207 em execução, com o T1 da R1
 * falho e dependente da I-206. I-208 aguardando a aprovação da demanda.
 */
export function semearDemandas(raiz: string): void {
  const banco = abrir(raiz);
  criarDemanda(
    banco,
    demanda("I-206", "execucao", {
      rodadas: [rodada("I-206", 1, "aprovacao_pull_request"), rodada("I-206", 2, "desenvolvimento")],
      tickets: [
        ticket("I-206", 1, "implementar", 1, "concluido"),
        ticket("I-206", 2, "encerrar_rodada", 1, "concluido"),
        ticket("I-206", 3, "implementar", 2, "em_execucao"),
      ],
      evidencias: [
        {
          demanda_id: "I-206",
          ticket_id: 2,
          tipo: "pr_aberto",
          dados: { id: "7", url: "https://exemplo.com/pr/7" },
          em,
        },
      ],
    }),
  );
  criarDemanda(
    banco,
    demanda("I-207", "execucao", {
      rodadas: [rodada("I-207", 1, "desenvolvimento")],
      tickets: [ticket("I-207", 1, "implementar", 1, "falhou")],
    }),
  );
  criarDemanda(banco, demanda("I-208", "aprovacao_demanda"));
  banco.exec("INSERT INTO dependencia_demanda (demanda_id, depende_demanda_id) VALUES ('I-207', 'I-206')");
  banco.close();
}

/** Uma demanda sem ticket algum: nada em execução. */
export function semearDemandaOciosa(raiz: string): void {
  const banco = abrir(raiz);
  criarDemanda(banco, demanda("I-209", "aprovacao_demanda"));
  banco.close();
}
