// Apoio dos e2e das Pendências (CONCEITOS.md §11): um Projeto com uma Pendência de cada tipo, com o agendador desligado
// (o padrão), e a lista esperada na ordem de `desde`. Início, board, Projeto e chat leem este mesmo cenário.
import type { AgregadoDemanda, TipoPendencia } from "../apoio-testes/ciclo_de_vida/ciclo_de_vida_internos.ts";
import { abrirBancoDaFabriquinha } from "../src/server/composicao/banco_da_fabriquinha.ts";
import { gravarAgregadoPronto } from "../apoio-testes/cenarios/cenarios_de_demanda.ts";
import { projeto } from "./apoio.ts";

/** Uma Pendência esperada: o endereço do item e o tipo. */
export interface PendenciaEsperada {
  item: string;
  tipo: TipoPendencia;
}

/** Na ordem de `desde`, que é a do Início: cada demanda do cenário parou um minuto depois da anterior. */
export const PENDENCIAS_ESPERADAS: readonly PendenciaEsperada[] = [
  { item: "I-301", tipo: "gate_humano" },
  { item: "I-302.T1", tipo: "item_bloqueado" },
  { item: "I-303.R1", tipo: "dialogo_do_agente" },
  { item: "I-304", tipo: "revisao_parada" },
  { item: "I-305", tipo: "acao_externa" },
  { item: "I-306.T1", tipo: "despacho_parado" },
];

const instante = (minuto: number): string => `2026-10-11T12:0${String(minuto)}:00.000Z`;

function ticketDe(demanda_id: string, etapa: string, estado: string, minuto: number, rodada_id?: number) {
  return {
    demanda_id,
    ticket_id: 1,
    etapa,
    estado,
    estado_alterado_em: instante(minuto),
    criado_por: { tipo: "fabriquinha" },
    ...(rodada_id !== undefined && { rodada_id }),
  };
}

const rodadaDe = (demanda_id: string, estado: string, minuto: number) => ({
  demanda_id,
  rodada_id: 1,
  titulo: "rodada 1",
  estado,
  estado_alterado_em: instante(minuto),
  e2e: false,
  branch: `fabriquinha/${demanda_id}-1`,
});

function demandaParada(id: string, estado: string, minuto: number, resto: object = {}): AgregadoDemanda {
  return {
    demanda: {
      id,
      projeto: "loja",
      titulo: `Demanda ${id}`,
      tipo: "funcionalidade",
      descricao: "d",
      estado,
      estado_alterado_em: instante(minuto),
      criada_por: { tipo: "externo", ferramenta: "claude", sessao: id },
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
    arquivos_previstos_rodada: [],
    arquivos_previstos_demanda: [],
    versoes_plano: [],
    tentativas: [],
    pull_requests: [],
    ...resto,
  } as unknown as AgregadoDemanda;
}

/**
 * O projeto `loja` com seis demandas, uma Pendência em cada: I-301 no gate do planejamento, I-302 com o T1 falho, I-303
 * com a R1 na sessão de ajustes sem sessão viva, I-304 com a revisão integral parada (tudo concluído há mais de 2 min),
 * I-305 com o PR final à espera do merge na plataforma e I-306 com o T1 aberto e elegível (o agendador está desligado).
 */
export function semearPendencias(raiz: string): void {
  projeto(raiz);
  const banco = abrirBancoDaFabriquinha(raiz);
  gravarAgregadoPronto(banco, demandaParada("I-301", "gate_planejamento", 1));
  gravarAgregadoPronto(
    banco,
    demandaParada("I-302", "em_execucao", 2, {
      rodadas: [rodadaDe("I-302", "implementar", 2)],
      tickets: [ticketDe("I-302", "implementar", "falhou", 2, 1)],
    }),
  );
  gravarAgregadoPronto(
    banco,
    demandaParada("I-303", "em_execucao", 3, { rodadas: [rodadaDe("I-303", "ajustar_resultado", 3)] }),
  );
  gravarAgregadoPronto(
    banco,
    demandaParada("I-304", "em_execucao", 4, {
      rodadas: [rodadaDe("I-304", "concluida", 4)],
      tickets: [ticketDe("I-304", "implementar", "concluido", 4, 1)],
    }),
  );
  gravarAgregadoPronto(
    banco,
    demandaParada("I-305", "encerrar_demanda", 5, {
      rodadas: [rodadaDe("I-305", "concluida", 5)],
      tickets: [ticketDe("I-305", "encerrar_demanda", "aberto", 5)],
      encerramento: {
        demanda_id: "I-305",
        branch: "fabriquinha/I-305",
        base: "main",
        sha_verificado: "abc123",
        aguardando_merge_humano: true,
        limpeza_pendente: [],
      },
      pull_requests: [
        {
          numero: 12,
          url: "https://exemplo.com/pr/12",
          head: "abc123",
          estado: "aberto",
          atualizado_em: instante(5),
        },
      ],
    }),
  );
  gravarAgregadoPronto(
    banco,
    demandaParada("I-306", "em_execucao", 6, {
      rodadas: [rodadaDe("I-306", "implementar", 6)],
      tickets: [ticketDe("I-306", "implementar", "aberto", 6, 1)],
    }),
  );
  banco.close();
}
