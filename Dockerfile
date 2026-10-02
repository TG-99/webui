# ============================================================
#   STAGE 1: Build Go WS-SSH Multiplexer
# ============================================================
FROM golang:1.22-alpine AS builder

WORKDIR /src
COPY ws-ssh/main.go .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /ws-ssh-bin main.go

# ============================================================
#   STAGE 2: Final Runtime Container
# ============================================================
FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=1
ENV PORT=80

# Install required tools and SSH daemons
RUN apt-get update -qq && \
    apt-get install -y -qq --no-install-recommends \
        openssh-server \
        dropbear \
        python3 \
        python3-pip \
        python3-flask \
        procps \
        curl \
        jq \
        net-tools \
        passwd \
        ca-certificates && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy Go binary
COPY --from=builder /ws-ssh-bin /app/ws-ssh-bin
RUN chmod +x /app/ws-ssh-bin

# Copy Web Panel and Entrypoint
COPY panel /app/panel
COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

# Default SSH login banner
RUN echo '<center><font color="blue"><b>🌐 RAILWAY SSH CLOUD SERVER 🌐</b></font><br><br><font color="green">🛡️ CONNECTED VIA WEBSOCKET</font></center>' > /etc/issue.net

# Expose HTTP (80) and SSL (443) ports
EXPOSE 80 443

ENTRYPOINT ["/app/entrypoint.sh"]
