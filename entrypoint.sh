#!/bin/bash
set -e

echo "============================================================"
echo " ⚡ Starting Railway SSH & Web Panel Container"
echo "============================================================"

# Ensure directories exist
mkdir -p /var/run/sshd /data /etc/ssh-panel

# 1. Setup Persistent Storage (if /data volume is mounted)
if [ -f "/data/passwd.bak" ] && [ -f "/data/shadow.bak" ]; then
    echo "[✔] Restoring user accounts from persistent storage..."
    cp /data/passwd.bak /etc/passwd
    cp /data/shadow.bak /etc/shadow
    [ -f "/data/group.bak" ] && cp /data/group.bak /etc/group
else
    echo "[!] Initializing persistent storage backup..."
    cp /etc/passwd /data/passwd.bak 2>/dev/null || true
    cp /etc/shadow /data/shadow.bak 2>/dev/null || true
    cp /etc/group /data/group.bak 2>/dev/null || true
fi

# Link /etc/ssh-panel to /data if /data is available
if [ -d "/data" ]; then
    export DATA_DIR="/data"
fi

# 2. Setup SSH Host Keys
if [ ! -f "/etc/ssh/ssh_host_rsa_key" ]; then
    echo "[✔] Generating SSH host keys..."
    ssh-keygen -A
fi

# 3. Configure OpenSSH Daemon
cat > /etc/ssh/sshd_config.d/railway.conf << 'EOF'
Port 2222
PermitRootLogin yes
PasswordAuthentication yes
UseDNS no
Compression no
IPQoS throughput
MaxStartups 1000:30:2000
EOF

# Ensure root password exists or create default test user if needed
if [ -n "$DEFAULT_USER" ] && [ -n "$DEFAULT_PASS" ]; then
    if ! id "$DEFAULT_USER" &>/dev/null; then
        echo "[✔] Creating default user: $DEFAULT_USER"
        useradd -m -s /bin/bash "$DEFAULT_USER"
        echo "$DEFAULT_USER:$DEFAULT_PASS" | chpasswd
    fi
fi

# 4. Start OpenSSH Daemon in background
echo "[✔] Starting OpenSSH server on 127.0.0.1:2222..."
/usr/sbin/sshd -p 2222

# 5. Start Dropbear Daemon in background
echo "[✔] Starting Dropbear server on 127.0.0.1:2223..."
dropbear -p 127.0.0.1:2223 -W 65536 -b /etc/issue.net 2>/dev/null || true

# 6. Start Flask Web Panel in background
export PANEL_PORT=40460
echo "[✔] Starting SSH-UI Web Panel on 127.0.0.1:$PANEL_PORT..."
python3 /app/panel/app.py &
PANEL_PID=$!

# Wait for internal services to initialize
sleep 2

# 7. Start Public Go Multiplexer (WS-SSH + Web Panel on $PORT)
export PORT=${PORT:-80}
export SSH_ADDR="127.0.0.1:2222"
export PANEL_ADDR="127.0.0.1:40460"

echo "[✔] Starting WS-SSH & HTTP Multiplexer on public port $PORT..."
exec /app/ws-ssh-bin
