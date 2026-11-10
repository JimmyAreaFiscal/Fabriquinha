// Evidência do agente de uma execução da demanda (comparacao-sdlc-implementacao.md §6): `evidencia schema <tipo>` e
// `evidencia add I-<n>.T<m> <tipo>`. Traduz os argumentos para `adicionarEvidencia`, que valida na fronteira e grava.
// Implementar não tem comando: a Fabriquinha coleta e conclui.
import { adicionarEvidencia } from "../../aplicacao/agente/adicionar_evidencia.ts";
import { tipoDoAgente } from "../../aplicacao/agente/tipo_do_agente.ts";
import { comProcessoDoAgente } from "./agente_demanda.ts";
import { type Comando, lerJsonDoArquivo, schemaJsonDoTipo } from "./comando.ts";

export const COMANDOS_EVIDENCIA_DEMANDA: readonly Comando[] = [
  {
    nome: "evidencia schema",
    posicionais: ["<tipo>"],
    argumentos: {},
    executar: ({ posicionais }, deps) =>
      comProcessoDoAgente(deps, () => schemaJsonDoTipo(tipoDoAgente(String(posicionais[0])).tipo)),
  },
  {
    nome: "evidencia add",
    posicionais: ["I-<n>.T<m>", "<tipo>"],
    opcoesDeUso: "--dados <arquivo.json|-> [--arquivo <caminho>]...",
    argumentos: { options: { dados: { type: "string" }, arquivo: { type: "string", multiple: true } } },
    executar: ({ posicionais, opcoes }, deps) =>
      comProcessoDoAgente(deps, (banco, processo) =>
        adicionarEvidencia(
          banco,
          processo,
          {
            ticket: String(posicionais[0]),
            tipo: String(posicionais[1]),
            dados: opcoes.dados as string | undefined,
            anexos: (opcoes.arquivo ?? []) as string[],
          },
          (valor, opcao) => lerJsonDoArquivo(valor, deps.stdin, opcao),
        ),
      ),
  },
];
