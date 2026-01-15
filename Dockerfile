FROM ubuntu:22.04

ARG DEBIAN_FRONTEND=noninteractive

# Update the package list and install packages including Python
RUN apt-get -y update && apt-get install -y bash wget curl golang git ttyd nginx python3 python3-pip \
    && apt-get -y autoremove && apt-get -y autoclean

RUN ARCH=$(uname -m) && \
    if [ "$ARCH" = "x86_64" ]; then \
        URL="https://github.com/alist-org/alist/releases/latest/download/alist-linux-amd64.tar.gz"; \
    elif [ "$ARCH" = "aarch64" ] || [ "$ARCH" = "arm64" ]; then \
        URL="https://github.com/alist-org/alist/releases/latest/download/alist-linux-arm64.tar.gz"; \
    else \
        echo "Unsupported architecture: $ARCH" && exit 1; \
    fi && \
    wget -O alist.tar.gz "$URL" \
    && tar -xzvf alist.tar.gz \
    && rm -r alist*.tar.gz

RUN ARCH=$(uname -m) && \
    if [ "$ARCH" = "x86_64" ]; then \
        URL="https://github.com/coder/code-server/releases/download/v4.107.0/code-server-4.107.0-linux-amd64.tar.gz"; \
    elif [ "$ARCH" = "aarch64" ] || [ "$ARCH" = "arm64" ]; then \
        URL="https://github.com/coder/code-server/releases/download/v4.107.0/code-server-4.107.0-linux-arm64.tar.gz"; \
    else \
        echo "Unsupported architecture: $ARCH" && exit 1; \
    fi && \
    wget -O code-server.tar.gz "$URL" \
    && tar -xzvf code-server.tar.gz \
    && cp -r code-server /usr/lib/code-server \
    && ln -s /usr/lib/code-server/bin/code-server /bin/code-server \
    && rm -r code-server*.tar.gz

RUN curl https://cli-assets.heroku.com/install.sh | sh

RUN pip3 install requests python-dotenv

COPY ./web/settings.json ./var/lib/code-server/User/settings.json
COPY . .
RUN mkdir -p /data/ && cp ./web/config.json /data/config.json
RUN chmod +x ./script/nginx.sh ./script/alist.sh ./script/vs.sh ./script/ttyd.sh

RUN go mod init webui && go build -o bin/webui
CMD ["./bin/webui"]