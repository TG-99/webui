FROM ubuntu:22.04

RUN apt-get update && apt-get install -y curl wget golang git ttyd nginx python3 python3-pip
RUN curl -fsSL https://raw.githubusercontent.com/filebrowser/get/master/get.sh | bash
RUN curl https://cli-assets.heroku.com/install.sh | sh
RUN pip3 install requests python-dotenv

COPY . .
RUN chmod +x ./script/nginx.sh ./script/xui.sh ./script/fb.sh ./script/ttyd.sh

RUN go mod init webui && go build -o bin/webui
CMD ["./bin/webui"]