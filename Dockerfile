# Imagem do Ambiente (sandbox) da Fabriquinha: o pacote do pi é montado pela Fabriquinha; a imagem só traz Node e Git.
FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/* \
    # A worktree montada tem dono diferente do usuário do container; sem isto o git recusa o repositório.
    && git config --system --add safe.directory '*' \
    # O container não tem a configuração do git do host: o commit do ticket precisa de uma identidade.
    && git config --system user.name "Fabriquinha" \
    && git config --system user.email "fabriquinha@exemplo.com" \
    # Onde o AmbienteContainer grava o grupo de processos de cada comando.
    && mkdir -p /fabriquinha/pids \
    && chown node:node /fabriquinha/pids
# Usuário não-root: o Claude Code do claude-bridge recusa --dangerously-skip-permissions como root.
USER node
