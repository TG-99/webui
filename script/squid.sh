#!/bin/sh

set -ex  # Enable debugging and exit on errors

# Telegram Bot setup
BOT_MSG_URL="https://api.telegram.org/bot${TOKEN}/sendMessage"
tg_post_msg() {
  [ -n "$TOKEN" ] && [ -n "$CHATID" ] && curl -s -X POST "$BOT_MSG_URL" \
    -d chat_id="$CHATID" \
    -d "disable_web_page_preview=true" \
    -d "parse_mode=html" \
    -d "message_thread_id=${THREAD_ID}" \
    -d text="$1" || echo "Telegram variables not set, skipping message"
}

# Validate required environment variables
[ -z "$USERNAME" ] && echo "Missing USERNAME (-e USERNAME=...)" && exit 1
[ -z "$PASSWORD" ] && echo "Missing PASSWORD (-e PASSWORD=...)" && exit 1
[ -z "$NGROK_AUTHTOKEN" ] && echo "Missing NGROK_AUTHTOKEN (-e NGROK_AUTHTOKEN=...)" && exit 1

# Create Squid password file
htpasswd -cb /etc/squid/passwd "$USERNAME" "$PASSWORD"

# Start socat to forward TCP traffic
sed "s|http_port 3128|http_port ${SQUID_PORT}|" /etc/squid/squid.conf > /tmp/squid.conf && mv /tmp/squid.conf /etc/squid/squid.conf
socat "tcp-listen:$SQUID_PORT,reuseaddr,fork" "tcp:localhost:3129" &

# Authenticate and start ngrok
ngrok config add-authtoken "$NGROK_AUTHTOKEN"
ngrok tcp "$SQUID_PORT" > /tmp/ngrok.log 2>&1 &

# Wait for ngrok to initialize
sleep 5

# Extract public tunnel address and notify
PUBLIC_URL=$(curl -s http://localhost:4040/api/tunnels | grep -o 'tcp://[^"]*' | sed 's|tcp://||')
[ -n "$PUBLIC_URL" ] && tg_post_msg "Proxy Server: <code>http://$USERNAME:$PASSWORD@${PUBLIC_URL}</code>" || echo "Ngrok tunnel not found."
echo "{\"public_url\": \"http://$USERNAME:$PASSWORD@${PUBLIC_URL}\"}" > /var/www/html/public_url.json

# Start Squid in foreground
exec squid -NYCd 1
