FROM ubuntu:22.04

ARG DEBIAN_FRONTEND=noninteractive

# Update the package list and install packages including Python
RUN apt-get -y update && apt-get install -y bash wget curl golang git ttyd nginx python3 python3-pip \
    && apt-get install -y apache2-utils squid curl \
    && apt-get -y autoremove && apt-get -y autoclean

RUN curl -sSL https://ngrok-agent.s3.amazonaws.com/ngrok.asc \
  | tee /etc/apt/trusted.gpg.d/ngrok.asc >/dev/null \
  && echo "deb https://ngrok-agent.s3.amazonaws.com buster main" \
  | tee /etc/apt/sources.list.d/ngrok.list \
  && apt-get update \
  && apt-get install ngrok

RUN pip3 install requests python-dotenv
# Others
COPY ./web/settings.json ./var/lib/code-server/User/settings.json
RUN wget https://github.com/alist-org/alist/releases/latest/download/alist-linux-amd64.tar.gz \
    && tar -xzvf alist*.tar.gz \
    && rm -r alist*.tar.gz
RUN curl -fsSL https://raw.githubusercontent.com/filebrowser/get/master/get.sh | bash
RUN curl https://cli-assets.heroku.com/install.sh | sh

COPY . .
RUN mkdir -p /data/ && cp ./web/config.json /data/config.json
RUN chmod +x ./script/nginx.sh ./script/alist.sh ./script/vs.sh ./script/fb.sh ./script/ttyd.sh ./script/squid.sh

COPY ./web/squid.conf /etc/squid/squid.conf
EXPOSE 3128/tcp

RUN go mod init webui && go build -o bin/webui
CMD ["./bin/webui"]