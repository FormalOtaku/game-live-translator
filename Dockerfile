FROM mcr.microsoft.com/devcontainers/javascript-node:20

ARG APT_PACKAGES="git curl ca-certificates"

RUN if [ -n "$APT_PACKAGES" ]; then \
      set -f && \
      set -- $APT_PACKAGES && \
      apt-get update && \
      DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends "$@" && \
      rm -rf /var/lib/apt/lists/*; \
    fi

WORKDIR /workspace
