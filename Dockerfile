FROM rir18/mltb:latest

ARG DEBIAN_FRONTEND=noninteractive
RUN apt-get -y update && \
	apt-get install -y golang ttyd zip bash
RUN curl -fsSL https://raw.githubusercontent.com/filebrowser/get/master/get.sh | bash
RUN curl https://cli-assets.heroku.com/install.sh | sh

COPY . .
COPY /web/filebrowser.json /etc/filebrowser/filebrowser.json

RUN go mod init webui && go build -o bin/webui
CMD webui
