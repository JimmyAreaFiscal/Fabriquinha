// provisório: remover no ticket 22 (mudou para src/modulos/ciclo_de_vida/planejamento/, pela fachada)
export {
  CorrecaoDoPlano,
  correcaoDasRodadasNovas,
  correcaoDosTicketsDaRodada,
  lerPlanoGravado,
  OrigemDaVersao,
  Plano,
  PlanoProposto,
} from "../../../ciclo_de_vida/publico.ts";
// O que o agregado acrescenta à materialização do Planejamento: os CA-n da definição congelada e o estado inicial de
// cada item novo, que são do Processo (ticket 12).
import { z } from "zod";
import type { AgregadoDemanda } from "./agregado_demanda.ts";
import { type CorrecaoDoPlano, materializarVersaoDoPlano, type PlanoProposto } from "../../../ciclo_de_vida/publico.ts";
import type { Instante } from "../../../../shared/nucleo/primitivos.ts";
import { estadoDaRodadaNaEtapa, PRIMEIRA_ETAPA_DA_RODADA } from "../ciclo_de_vida/ciclos.ts";

// A definição congelada guarda os `CA-n` em `dados.criterios[].id` (F3); o resto do payload não interessa aqui.
const DadosCriterios = z.object({ criterios: z.array(z.object({ id: z.string() })) });

/** Os `CA-n` da definição congelada da demanda; sem definição, nenhum. */
export function criteriosDaDefinicaoCongelada(ag: Pick<AgregadoDemanda, "evidencias">): Set<string> {
  const definicao = ag.evidencias.find(
    (e) => e.tipo === "criterios_aceite" && e.rodada_id === undefined && e.ticket_id === undefined,
  );
  return new Set(DadosCriterios.safeParse(definicao?.dados).data?.criterios.map((c) => c.id));
}

/**
 * Acrescenta ao agregado o que a versão do Plano materializa (`materializarVersaoDoPlano`): os tickets novos abertos e
 * as rodadas novas no estado da primeira Etapa da rodada. Quem grava o agregado o valida.
 */
export function materializar(
  ag: AgregadoDemanda,
  versao: PlanoProposto | CorrecaoDoPlano,
  ctx: { readonly agora: Instante },
): AgregadoDemanda {
  const { agora } = ctx;
  const materializado = materializarVersaoDoPlano(ag, versao, {
    agora,
    criteriosDaDefinicao: criteriosDaDefinicaoCongelada(ag),
  });
  return {
    ...ag,
    tickets: [
      ...ag.tickets,
      ...materializado.tickets.map((ticket) => ({ ...ticket, estado: "aberto" as const, estado_alterado_em: agora })),
    ],
    dependencias_ticket: [...ag.dependencias_ticket, ...materializado.dependencias_ticket],
    caminhos_ticket: [...ag.caminhos_ticket, ...materializado.caminhos_ticket],
    rodadas: [
      ...ag.rodadas,
      ...materializado.rodadas.map((rodada) => ({
        ...rodada,
        estado: estadoDaRodadaNaEtapa(PRIMEIRA_ETAPA_DA_RODADA),
        estado_alterado_em: agora,
      })),
    ],
    dependencias_rodada: [...ag.dependencias_rodada, ...materializado.dependencias_rodada],
    criterios_citados: [...ag.criterios_citados, ...materializado.criterios_citados],
    arquivos_previstos_rodada: [...ag.arquivos_previstos_rodada, ...materializado.arquivos_previstos_rodada],
    arquivos_previstos_demanda: [...ag.arquivos_previstos_demanda, ...materializado.arquivos_previstos_demanda],
    versoes_plano: [...ag.versoes_plano, materializado.versao_plano],
  };
}
