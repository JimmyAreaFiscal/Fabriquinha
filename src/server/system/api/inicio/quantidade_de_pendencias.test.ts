// O contador de pendências do menu: conta o que aguarda o Auditor pela mesma regra do Aguarda você do Início, sem montar
// o Início (o mês, o board e as sessões que rodam).
import assert from "node:assert/strict";
import { test } from "node:test";
import { cenarioDoInicio, rodada, ticket } from "../../../../../apoio-testes/cenarios/cenario_do_inicio.ts";
import { fabricaDeBancosTemporarios } from "../../../../../apoio-testes/banco/banco_temporario.ts";
import {
  gravarAgregadoPronto,
  montarAgregadoDemanda,
} from "../../../../../apoio-testes/cenarios/cenarios_de_demanda.ts";
import { contarExecucoesSql } from "../../../../../estresse/referencia/contador_de_execucoes_sql.ts";
import { relogioDoSistema } from "../../../../shared/nucleo/relogio.ts";
import { consultarInicio } from "./consulta_inicio.ts";
import { consultarQuantidadeDePendencias } from "./quantidade_de_pendencias.ts";
import { montarCicloDeVidaDoBanco, montarDemandasDoBanco } from "../../banco_da_fabriquinha.ts";

const abrirBancoTemporario = fabricaDeBancosTemporarios();
const semSessaoViva = () => undefined;

test("conta as mesmas Pendências do Aguarda você do Início", () => {
  const { banco } = abrirBancoTemporario();
  cenarioDoInicio(banco);
  assert.deepEqual(
    consultarQuantidadeDePendencias(
      banco,
      montarCicloDeVidaDoBanco(banco),
      montarDemandasDoBanco(banco),
      relogioDoSistema,
      semSessaoViva,
    ),
    {
      quantidade: consultarInicio(
        banco,
        montarCicloDeVidaDoBanco(banco),
        montarDemandasDoBanco(banco),
        relogioDoSistema,
        semSessaoViva,
      ).aguarda.length,
    },
  );
});

test("a regra única: mudar o que é Pendência num só lugar (o agendador) muda o contador e o Início juntos", () => {
  const { banco } = abrirBancoTemporario();
  banco.exec(`INSERT INTO projeto (nome, raiz_git, branch_base, hospedagem, chave_sonarqube)
    VALUES ('loja', '/repos/loja', 'main', 'github', 'k')`);
  gravarAgregadoPronto(
    banco,
    montarAgregadoDemanda("I-311", "em_execucao", {
      rodadas: [rodada("I-311", 1, "implementar")],
      tickets: [ticket("I-311", 5, "implementar", "aberto", { rodada_id: 1 })],
    }),
  );
  const contadorEInicio = () => [
    consultarQuantidadeDePendencias(
      banco,
      montarCicloDeVidaDoBanco(banco),
      montarDemandasDoBanco(banco),
      relogioDoSistema,
      semSessaoViva,
    ).quantidade,
    consultarInicio(
      banco,
      montarCicloDeVidaDoBanco(banco),
      montarDemandasDoBanco(banco),
      relogioDoSistema,
      semSessaoViva,
    ).aguarda.length,
  ];
  // Com o agendador desligado, o ticket aberto e elegível é o despacho parado; ligado, o agendador o despacha.
  assert.deepEqual(contadorEInicio(), [1, 1]);
  banco.exec("UPDATE configuracao SET agendador_ativo = 1");
  assert.deepEqual(contadorEInicio(), [0, 0]);
});

test("o contador não monta o Início: faz menos execuções SQL que ele", async () => {
  const { banco } = abrirBancoTemporario();
  cenarioDoInicio(banco);
  const doContador = await contarExecucoesSql(() =>
    Promise.resolve(
      consultarQuantidadeDePendencias(
        banco,
        montarCicloDeVidaDoBanco(banco),
        montarDemandasDoBanco(banco),
        relogioDoSistema,
        semSessaoViva,
      ),
    ),
  );
  const doInicio = await contarExecucoesSql(() =>
    Promise.resolve(
      consultarInicio(
        banco,
        montarCicloDeVidaDoBanco(banco),
        montarDemandasDoBanco(banco),
        relogioDoSistema,
        semSessaoViva,
      ),
    ),
  );
  assert.ok(
    doContador < doInicio,
    `o contador fez ${String(doContador)} execuções SQL e o Início, ${String(doInicio)}`,
  );
});
