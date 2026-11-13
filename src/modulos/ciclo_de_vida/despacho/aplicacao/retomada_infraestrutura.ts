// Retomada automática do ticket que falhou por infraestrutura: o reinício do serviço, a falha transitória (rede, tempo,
// SonarQube fora do ar) e a cota estourada do provedor não são culpa do ticket nem decisão do Auditor. A cada ciclo do
// agendador, a Fabriquinha devolve esses tickets a `aberto`, se a política das Tentativas manda; a seleção global os
// escolhe como os demais.
import type { DatabaseSync } from "node:sqlite";
import { formatarTicketRef, resolverConfiguracaoAgente } from "../../etapas/publico.ts";
import {
  desdeAReabertura,
  POLITICA_DE_TENTATIVAS,
  retomarFalhaDeInfraestruturaDoTicket,
  tentativasDoTicket,
} from "../../processo/publico.ts";
import { type Relogio, relogioDoSistema, relogioFixo } from "../../../../shared/nucleo/relogio.ts";
import { noLog } from "../../../../shared/infra/registro.ts";
import { agregadosDespachados } from "./despacho.ts";
import type { Modelo } from "../../../sessoes/publico.ts";
import { projetosCadastrados } from "../../conducao/publico.ts";

/**
 * Devolve a `aberto` os tickets falhos das demandas em andamento cuja política manda retomar: o do reinício sempre e na
 * hora; o transitório depois da espera; o da cota com o modelo reserva. Os que passaram do limite de falhas seguidas, e
 * os que pedem o Auditor, ficam para ele. Devolve os endereços retomados; o erro de um não para os outros.
 */
export function retomarFalhasDeInfraestrutura(banco: DatabaseSync, relogio: Relogio = relogioDoSistema): string[] {
  const agora = relogio.agora();
  const retomados: string[] = [];
  for (const ag of agregadosDespachados(banco)) {
    for (const t of ag.tickets) {
      if (t.estado !== "falhou") continue;
      const historico = desdeAReabertura(tentativasDoTicket(ag.tentativas, t.ticket_id));
      const passo = POLITICA_DE_TENTATIVAS.proximoPasso(t.etapa, historico);
      if (passo.tipo !== "retomar_automaticamente") continue;
      if (Date.parse(agora) - Date.parse(t.estado_alterado_em) < passo.esperaMs) continue;
      let modelo: Modelo | undefined;
      if (passo.trocarProvedor) {
        const etapa = projetosCadastrados()
          .buscarProjeto(banco, ag.demanda.projeto)
          ?.etapas.find((e) => e.etapa === t.etapa);
        const { modelo: modeloResolvido } = resolverConfiguracaoAgente({
          ticket: t.configuracao_agente,
          etapaDoProjeto: etapa?.configuracao_agente,
          padrao: {},
        });
        modelo = POLITICA_DE_TENTATIVAS.modeloReserva(modeloResolvido);
        if (!modelo) continue;
      }
      try {
        // Todas as retomadas do ciclo no mesmo instante, o do começo da varredura.
        retomarFalhaDeInfraestruturaDoTicket(banco, t, modelo, relogioFixo(agora));
        retomados.push(formatarTicketRef(t));
      } catch (erro) {
        noLog(erro);
      }
    }
  }
  return retomados;
}
