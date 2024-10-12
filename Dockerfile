FROM ubuntu:22.04

ARG DEBIAN_FRONTEND=noninteractive

# Update the package list and install packages
RUN apt-get -y update && apt-get install -y bash wget curl golang git ttyd nginx && \
        # Intall Caddy Reverse Proxy
        apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl && \
        curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg && \
        curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list && \
        apt-get -y update && apt-get install -y caddy

# Others
RUN wget https://github.com/alist-org/alist/releases/latest/download/alist-linux-amd64.tar.gz && tar -xzvf alist*.tar.gz && rm -r alist*.tar.gz
RUN curl -fsSL https://raw.githubusercontent.com/filebrowser/get/master/get.sh | bash
RUN curl https://cli-assets.heroku.com/install.sh | sh

# Copy
COPY . .
RUN mkdir -p /data/ && cp ./web/config.json /data/config.json
RUN chmod +x ./script/nginx.sh ./script/fb.sh ./script/ttyd.sh ./script/alist.sh

RUN apt-get -y autoremove && apt-get -y autoclean

RUN go mod init webui && go build -o bin/webui
CMD ["./bin/webui"]