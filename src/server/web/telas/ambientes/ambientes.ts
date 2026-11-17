// Ambientes (F7 §4.4) como funções puras: a tabela dos containers do conjunto, com o uso e o que roda em cada um. O DOM
// e a rede ficam em ambientes-montar.ts.
import type { AmbientesEmUso } from "../../../system/api/contrato/ambientes.ts";
import { escapar } from "../../apresentacao/render.ts";
import { nomeDoSlot, usoMedido } from "../configuracao/configuracao.ts";

type ContainerEmUso = AmbientesEmUso["containers"][number];

/** A célula com o valor e os atributos dele; sem valor, o traço sem atributo, para ser o mesmo em toda coluna. */
const celulaOuTraco = (valor: string | null, atributosDoValor = ""): string =>
  valor === null ? "<td>—</td>" : `<td${atributosDoValor}>${escapar(valor)}</td>`;

function linhaDoContainer({
  id,
  slot,
  imagem,
  estado,
  medido,
  projeto,
  demanda,
  ticket,
  worktree,
  caminho_completo_da_worktree,
  branch,
}: ContainerEmUso): string {
  const tituloDaWorktree =
    caminho_completo_da_worktree === null ? "" : ` title="${escapar(caminho_completo_da_worktree)}"`;
  return `<tr data-container="${escapar(id)}"><td>${nomeDoSlot(slot)}</td><td class="mono corta" title="${escapar(imagem)}">${escapar(imagem)}</td><td>${estado}</td>${usoMedido(medido)}${celulaOuTraco(projeto)}${celulaOuTraco(demanda)}${celulaOuTraco(ticket)}${celulaOuTraco(worktree, ` class="mono"${tituloDaWorktree}`)}${celulaOuTraco(branch, ' class="mono"')}</tr>`;
}

/** A página `/ambientes`: no `host_local` diz que não há containers; no `container`, a tabela do conjunto. */
export function paginaDeAmbientes({ tipo, containers }: AmbientesEmUso): string {
  let conteudoAbaixoDoTitulo = '<p class="muted">O trabalho roda no host: não há containers.</p>';
  if (tipo === "container") {
    conteudoAbaixoDoTitulo =
      containers.length > 0
        ? `<div class="rola" data-rolagem-dos-ambientes><table class="tabela tabela-dos-ambientes"><thead><tr><th>Container</th><th>Imagem</th><th>Estado</th><th class="num">CPU</th><th class="num">Memória</th><th>Projeto</th><th>Demanda</th><th>Ticket</th><th>Worktree</th><th>Branch</th></tr></thead><tbody>${containers.map(linhaDoContainer).join("")}</tbody></table></div>`
        : '<p class="muted">Nenhum container no conjunto.</p>';
  }
  return `<div class="cabeca-pagina"><h1>Ambientes</h1><span class="muted">o uso e o que roda em cada container · atualiza a cada 5 s</span></div>${conteudoAbaixoDoTitulo}`;
}
