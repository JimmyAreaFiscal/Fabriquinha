// Os acessos de rede autorizados de um sandbox (MELHORIAS §8): a saída é para a internet e, no host (`host-gateway`),
// só para a porta da API do agente. As regras vivem no namespace de rede do sandbox e somem com ele; quem as aplica,
// num container à parte, é o gerador dos sandboxes, que desfaz a criação quando elas falham.
import { ErroDeRegra } from "../../../../shared/nucleo/erros.ts";

/** A imagem só com o `iptables`, que o container da rede usa para travar a saída do Ambiente para o host. */
export const IMAGEM_DAS_REGRAS_DE_REDE = "fabriquinha/regras-de-rede:1";
export const DOCKERFILE_DAS_REGRAS_DE_REDE = "FROM alpine\nRUN apk add --no-cache iptables\n";

/** O IP do host no `/etc/hosts` do sandbox: sem ele, a saída para o host não tem como ser travada. */
export function ipDoHostNoArquivoDeHosts(arquivoDeHosts: string): string {
  const ipDoHost = /^(\d+\.\d+\.\d+\.\d+)\s+host\.docker\.internal\b/m.exec(arquivoDeHosts)?.[1];
  if (!ipDoHost)
    throw new ErroDeRegra(
      "o container não conhece o host.docker.internal",
      "confira a versão do Docker (host-gateway)",
    );
  return ipDoHost;
}

/** O roteiro do `iptables` que deixa passar para o host só a porta da API e recusa o resto do host. */
export const roteiroQueSoLiberaAPortaDaApi = (ipDoHost: string, portaDaApi: number): string =>
  `iptables -A OUTPUT -d ${ipDoHost} -p tcp --dport ${String(portaDaApi)} -j ACCEPT && iptables -A OUTPUT -d ${ipDoHost} -j REJECT`;
