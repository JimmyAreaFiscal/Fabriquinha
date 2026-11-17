// I-312, CA-4: a sessão interativa em gate não segura sandbox (o pi saiu e o Ambiente voltou ao conjunto). A mensagem
// seguinte do Auditor abre outra execução na mesma sessão, e o pi sobe, com o mesmo session-id, no Ambiente que quem
// pediu alocou de novo.
import assert from "node:assert/strict";
import { test } from "node:test";
import { abrirBancoTemporario } from "../../../../../apoio-testes/banco/banco_temporario.ts";
import { relogioDoSistema } from "../../../../shared/nucleo/relogio.ts";
import type { Ambiente } from "../../../ambiente/publico.ts";
import type { Harness, LancamentoDoTicket } from "../../harness/publico.ts";
import { montarSessoesDeAgente, motorDoBanco } from "./montagem_das_sessoes.ts";

const T = "2026-01-01T00:00:00.000Z";
const CONTEXTO = { demanda_id: "I-1", ticket_id: 1 };

const ambienteDoConjunto = (id: string) => ({ id, processosMorremComOServico: false }) as unknown as Ambiente;

/** Um harness cujo pi vive até ser parado e registra onde e com que sessão cada um foi lançado. */
function harnessQueRegistraOsLancamentos() {
  const lancamentos: { ambiente: Ambiente; lancamento: LancamentoDoTicket }[] = [];
  const harness = {
    lancar(ambiente: Ambiente, lancamento: LancamentoDoTicket) {
      lancamentos.push({ ambiente, lancamento });
      let sair!: (codigo: number) => void;
      const saiu = new Promise<number>((resolve) => (sair = resolve));
      return {
        identificador: { ambiente_id: ambiente.id, grupo_processo: 1 },
        enviar: () => undefined,
        saiu,
        parar: () => {
          sair(0);
          return saiu.then(() => undefined);
        },
      };
    },
    arquivoDaSessao: () => undefined,
    lerUsoDaSessao: () => [],
  } as unknown as Harness;
  return { harness, lancamentos };
}

test("CA-4: a mensagem do Auditor depois da devolução do sandbox retoma o pi na mesma sessão, com o mesmo session-id, no Ambiente realocado", async () => {
  const { banco, fechar } = abrirBancoTemporario();
  banco.exec(`INSERT INTO projeto (nome, raiz_git, branch_base, hospedagem, chave_sonarqube)
      VALUES ('p', '/repo/p', 'main', 'github', 'k');
    INSERT INTO demanda (id, projeto, titulo, tipo, descricao, estado, estado_alterado_em, criada_por_ferramenta, criada_por_sessao, enviada, branch) VALUES ('I-1', 'p', 't', 'funcionalidade', 'd', 'gate_planejamento', '${T}', 'f', 's', 1, 'fabriquinha/I-1');
    INSERT INTO processo_demanda (demanda_id, estado, estado_alterado_em, branch) SELECT id, estado, estado_alterado_em, branch FROM demanda;
    INSERT INTO ticket_demanda (demanda_id, ticket_id, etapa, estado, estado_alterado_em)
      VALUES ('I-1', 1, 'planejar', 'em_execucao', '${T}');`);
  const { harness, lancamentos } = harnessQueRegistraOsLancamentos();
  const sessoes = montarSessoesDeAgente({ banco, harness });
  const alocacoes: string[] = [];
  const pedirExecucaoNoAmbiente = (ambienteId: string) =>
    sessoes.lancar({
      contexto: CONTEXTO,
      modo: "interativo",
      limiteMin: 30,
      relogio: relogioDoSistema,
      aoAbrir: () => undefined,
      preparar: ({ sessao, dir }) => {
        alocacoes.push(ambienteId);
        return Promise.resolve({
          lancamento: {
            tipo: "ticket",
            raiz: dir,
            sessao: sessao.id,
            dir,
            skills: [],
            modelo: undefined,
            modo: "interativo",
            repositorio: "/repo/p",
          },
          cwd: dir,
          ambiente: ambienteDoConjunto(ambienteId),
          prompt: undefined,
        });
      },
      aoEncerrar: () => Promise.resolve(),
    });

  // A sessão do plano assenta no gate, o pi sai e o Ambiente volta ao conjunto.
  const primeira = pedirExecucaoNoAmbiente("amb-1");
  while (lancamentos.length < 1) await new Promise((r) => setTimeout(r, 10));
  await sessoes.encerrar(primeira.execucao.id);
  await primeira.fim;

  // A mensagem do Auditor: nova execução, na mesma sessão, com Ambiente alocado de novo.
  const segunda = pedirExecucaoNoAmbiente("amb-2");
  while (lancamentos.length < 2) await new Promise((r) => setTimeout(r, 10));

  assert.equal(segunda.sessao.id, primeira.sessao.id);
  assert.notEqual(segunda.execucao.id, primeira.execucao.id);
  assert.deepEqual(alocacoes, ["amb-1", "amb-2"]);
  assert.deepEqual(
    lancamentos.map((l) => [l.ambiente.id, l.lancamento.sessao]),
    [
      ["amb-1", primeira.sessao.id],
      ["amb-2", primeira.sessao.id],
    ],
  );

  await sessoes.encerrar(segunda.execucao.id);
  await segunda.fim;
  assert.equal(motorDoBanco(banco).situacao(primeira.sessao.id), undefined);
  fechar();
});
