// Quem fala em /api/agente/*: o processo vivo dono do token de `Authorization: Bearer <token>`. O cookie do navegador não
// vale aqui, e o token de um processo encerrado, desconhecido ou ausente é 401; o que o token alcança é o ticket do próprio processo.
import type { IncomingHttpHeaders } from "node:http";
import type { DatabaseSync } from "node:sqlite";
import { type EscopoDoAgente, resolverEscopoDoToken } from "../../../modulos/ciclo_de_vida/publico.ts";
import { ErroHttp } from "../erros.ts";

export function autenticarAgente(banco: DatabaseSync, cabecalhos: IncomingHttpHeaders): EscopoDoAgente {
  const token = /^Bearer (\S+)$/.exec(cabecalhos.authorization ?? "")?.[1];
  const agente = token === undefined ? undefined : resolverEscopoDoToken(banco, token);
  if (agente === undefined) {
    throw new ErroHttp(401, "token ausente, desconhecido ou de execução encerrada (confira FABRIQUINHA_TOKEN)");
  }
  return agente;
}
