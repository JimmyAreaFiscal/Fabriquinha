// `POST /api/agente/evidencias` (`evidencia add`): o agente manda o caminho que declara para cada anexo, os bytes em
// base64 e o SHA-256. Quem confere que o arquivo é da worktree ou da saída do ticket, e que o SHA-256 bate, é o caso de
// uso (`adicionarEvidenciaComAnexosEnviados`); a rota só decodifica os bytes.
import { exigirTicketProprio } from "../../../aplicacao/agente/escopo.ts";
import { PedidoEvidenciaAdd, RespostaEvidenciaAdd } from "../../contrato/agente.ts";
import {
  CASOS_DE_USO_DO_AGENTE,
  type CasosDeUsoDoAgente,
  PRESENTE,
  processoDoAgente,
  PREFIXO_DA_API_DO_AGENTE,
  type RotaDoAgente,
} from "./rotas.ts";

export function rotaDeEvidenciaAdd(casos: CasosDeUsoDoAgente = CASOS_DE_USO_DO_AGENTE): RotaDoAgente {
  return {
    metodo: "POST",
    caminho: `${PREFIXO_DA_API_DO_AGENTE}evidencias`,
    resposta: RespostaEvidenciaAdd,
    tratar: ({ banco, agente, corpo }) => {
      const { ticket, tipo, dados, anexos } = PedidoEvidenciaAdd.parse(corpo);
      exigirTicketProprio(agente, ticket, true);
      return casos.adicionarEvidencia(
        banco,
        processoDoAgente(agente),
        {
          ticket,
          tipo,
          dados: dados === undefined ? undefined : PRESENTE,
          anexos: anexos.map(({ caminho, conteudo_base64, sha256 }) => ({
            caminho,
            conteudo: Buffer.from(conteudo_base64, "base64"),
            sha256,
          })),
        },
        () => Promise.resolve(dados),
      );
    },
  };
}
