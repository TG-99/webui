FROM ubuntu:22.04

ARG DEBIAN_FRONTEND=noninteractive
ARG NEED_AUTH=false
ENV NEED_AUTH=${NEED_AUTH}

# Update the package list and install packages including Python
RUN apt-get -y update && apt-get install -y bash wget curl golang git ttyd nginx python3 python3-pip \
    && apt-get install -y apache2-utils squid \
    && apt-get -y autoremove && apt-get -y autoclean

RUN ARCH=$(uname -m) && \
    if [ "$ARCH" = "x86_64" ]; then \
      NGROK_URL="https://bin.equinox.io/c/bNyj1mQVY4c/ngrok-v3-stable-linux-amd64.tgz"; \
    elif [ "$ARCH" = "aarch64" ]; then \
      NGROK_URL="https://bin.equinox.io/c/bNyj1mQVY4c/ngrok-v3-stable-linux-arm64.tgz"; \
    else \
      echo "Unsupported architecture: $ARCH" && exit 1; \
    fi && \
    wget "$NGROK_URL" -O ngrok.tgz && tar xvzf ngrok.tgz -C /usr/local/bin && rm ngrok.tgz

RUN wget https://github.com/alist-org/alist/releases/latest/download/alist-linux-amd64.tar.gz \
    && tar -xzvf alist*.tar.gz \
    && rm -r alist*.tar.gz
RUN curl -fsSL https://raw.githubusercontent.com/filebrowser/get/master/get.sh | bash
RUN curl https://cli-assets.heroku.com/install.sh | sh

RUN pip3 install requests python-dotenv

COPY ./web/settings.json ./var/lib/code-server/User/settings.json
COPY /web/squid_*.conf /tmp/
RUN if [ "$NEED_AUTH" = "true" ]; then \
        cp /tmp/squid_auth.conf /etc/squid/squid.conf; \
    else \
        cp /tmp/squid_noauth.conf /etc/squid/squid.conf; \
    fi
COPY . .
RUN mkdir -p /data/ && cp ./web/config.json /data/config.json
RUN chmod +x ./script/nginx.sh ./script/alist.sh ./script/vs.sh ./script/fb.sh ./script/ttyd.sh ./script/squid.sh

EXPOSE 3128/tcp

RUN go mod init webui && go build -o bin/webui
CMD ["./bin/webui"]