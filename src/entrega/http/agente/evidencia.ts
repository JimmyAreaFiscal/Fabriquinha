// `evidencia add` em dois passos, para o vídeo de 500 MiB não virar string nem Buffer: `POST /api/agente/anexos` recebe cada
// anexo como corpo binário e confere o SHA-256 em blocos; `POST /api/agente/evidencias` cita os anexos já enviados. Quem confere
// que o arquivo é da worktree ou da saída do ticket, e que o do host tem o mesmo SHA-256, é o caso de uso
// (`adicionarEvidenciaComAnexosEnviados`).
import { createHash } from "node:crypto";
import { exigirTicketProprio } from "../../../sdlc/aplicacao/agente/escopo.ts";
import { ErroDeRegra } from "../../../compartilhado/nucleo/erros.ts";
import { LIMITE } from "../../../qualidade/nucleo/evidencias/schemas.ts";
import {
  ParametrosDoAnexoEnviado,
  PedidoEvidenciaAdd,
  RespostaAnexoEnviado,
  RespostaEvidenciaAdd,
} from "../../contrato/agente.ts";
import {
  CASOS_DE_USO_DO_AGENTE,
  type CasosDeUsoDoAgente,
  PRESENTE,
  processoDoAgente,
  PREFIXO_DA_API_DO_AGENTE,
  type RotaDoAgente,
} from "./rotas.ts";

const MAIOR_ANEXO = Math.max(...Object.values(LIMITE));

/** O SHA-256 dos blocos do fluxo, sem guardá-los. Passando de `limite`, lê até o fim sem somar, para a resposta chegar ao cliente. */
async function sha256DoFluxo(fluxo: AsyncIterable<Buffer>, limite: number): Promise<{ sha256: string; bytes: number }> {
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const bloco of fluxo) {
    bytes += bloco.length;
    if (bytes <= limite) hash.update(bloco);
  }
  return { sha256: hash.digest("hex"), bytes };
}

const chaveDoAnexo = ({ caminho, sha256 }: RespostaAnexoEnviado): string => `${sha256}:${caminho}`;

export function rotasDeEvidenciaAdd(casos: CasosDeUsoDoAgente = CASOS_DE_USO_DO_AGENTE): RotaDoAgente[] {
  // Os anexos já enviados, por processo: o caminho e o SHA-256 conferidos que a evidência ainda não citou.
  // ponytail: na memória do serviço; reiniciar o serviço pede o reenvio, e o que o agente não cita fica até o reinício.
  const conferidos = new Map<string, Set<string>>();
  return [
    {
      metodo: "POST",
      caminho: `${PREFIXO_DA_API_DO_AGENTE}anexos`,
      resposta: RespostaAnexoEnviado,
      corpoEmFluxo: true,
      tratar: async ({ agente, query, corpo }) => {
        const anexo = ParametrosDoAnexoEnviado.parse({
          caminho: query.get("caminho"),
          sha256: query.get("sha256"),
        });
        const { sha256, bytes } = await sha256DoFluxo(corpo as AsyncIterable<Buffer>, MAIOR_ANEXO);
        if (bytes > MAIOR_ANEXO) {
          throw new ErroDeRegra(
            `${anexo.caminho} passa de ${String(MAIOR_ANEXO / 1024 / 1024)} MiB`,
            "reduza o arquivo",
          );
        }
        if (sha256 !== anexo.sha256) {
          throw new ErroDeRegra(
            `os bytes enviados de ${anexo.caminho} não têm o SHA-256 declarado`,
            "envie o arquivo de novo",
          );
        }
        const trabalho = agente.ator.trabalho_id;
        conferidos.set(trabalho, (conferidos.get(trabalho) ?? new Set<string>()).add(chaveDoAnexo(anexo)));
        return anexo;
      },
    },
    {
      metodo: "POST",
      caminho: `${PREFIXO_DA_API_DO_AGENTE}evidencias`,
      resposta: RespostaEvidenciaAdd,
      tratar: async ({ banco, agente, corpo }) => {
        const { ticket, tipo, dados, anexos } = PedidoEvidenciaAdd.parse(corpo);
        exigirTicketProprio(agente, ticket, true);
        const doProcesso = conferidos.get(agente.ator.trabalho_id) ?? new Set<string>();
        for (const anexo of anexos) {
          if (!doProcesso.has(chaveDoAnexo(anexo))) {
            throw new ErroDeRegra(
              `${anexo.caminho} não foi enviado com esse SHA-256`,
              "envie o arquivo antes da evidência",
            );
          }
        }
        const resposta = await casos.adicionarEvidencia(
          banco,
          processoDoAgente(agente),
          { ticket, tipo, dados: dados === undefined ? undefined : PRESENTE, anexos },
          () => Promise.resolve(dados),
        );
        for (const anexo of anexos) doProcesso.delete(chaveDoAnexo(anexo));
        return resposta;
      },
    },
  ];
}
