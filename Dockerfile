# Imagem do Ambiente (sandbox) da Fabriquinha: o pacote do pi é montado pela Fabriquinha; a imagem traz Node, Git e Python,
# para os agentes rodarem código Python.
FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates python3 python3-pip python3-venv && rm -rf /var/lib/apt/lists/* \
    # A worktree montada tem dono diferente do usuário do container; sem isto o git recusa o repositório.
    && git config --system --add safe.directory '*' \
    # O container não tem a configuração do git do host: o commit do ticket precisa de uma identidade.
    && git config --system user.name "Fabriquinha" \
    && git config --system user.email "fabriquinha@exemplo.com" \
    # Onde o AmbienteContainer grava o grupo de processos de cada comando.
    && mkdir -p /fabriquinha/pids \
    && chown node:node /fabriquinha/pids
# Usuário não-root: o Claude Code do claude-bridge recusa --dangerously-skip-permissions como root.
# O fuso do host: sem ele, os testes de data e hora de src/server/web falham no container.
ENV TZ=America/Sao_Paulo
USER node
