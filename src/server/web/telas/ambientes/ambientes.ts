// Ambientes (F7 §4.4) como funções puras: a tabela dos containers do conjunto, com o uso e o que roda em cada um. O DOM
// e a rede ficam em ambientes-montar.ts.
import type { AmbientesEmUso } from "../../../system/api/contrato/ambientes.ts";
import { escapar } from "../../apresentacao/render.ts";
import { usoMedido } from "../configuracao/configuracao.ts";

type ContainerEmUso = AmbientesEmUso["containers"][number];

const talvezVazio = (valor: string | null, classe = ""): string =>
  `<td${classe}>${valor === null ? "—" : escapar(valor)}</td>`;

function linhaDoContainer({
  id,
  nome_do_container,
  imagem,
  estado,
  medido,
  projeto,
  demanda,
  ticket,
  worktree,
  branch,
}: ContainerEmUso): string {
  return `<tr data-container="${escapar(id)}">${talvezVazio(nome_do_container, ' class="mono"')}<td class="mono">${escapar(imagem)}</td><td>${estado}</td>${usoMedido(medido)}${talvezVazio(projeto)}${talvezVazio(demanda)}${talvezVazio(ticket)}${talvezVazio(worktree, ' class="mono"')}${talvezVazio(branch, ' class="mono"')}</tr>`;
}

/** A página `/ambientes`: no `host_local` diz que não há containers; no `container`, a tabela do conjunto. */
export function paginaDeAmbientes({ tipo, containers }: AmbientesEmUso): string {
  let corpo = '<p class="muted">O trabalho roda no host: não há containers.</p>';
  if (tipo === "container") {
    corpo =
      containers.length > 0
        ? `<div class="rola"><table class="tabela"><thead><tr><th>Container</th><th>Imagem</th><th>Estado</th><th class="num">CPU</th><th class="num">Memória</th><th>Projeto</th><th>Demanda</th><th>Ticket</th><th>Worktree</th><th>Branch</th></tr></thead><tbody>${containers.map(linhaDoContainer).join("")}</tbody></table></div>`
        : '<p class="muted">Nenhum container no conjunto.</p>';
  }
  return `<div class="cabeca-pagina"><h1>Ambientes</h1><span class="muted">o uso e o que roda em cada container · atualiza a cada 5 s</span></div>${corpo}`;
}
