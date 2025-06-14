FROM ubuntu:22.04

ARG DEBIAN_FRONTEND=noninteractive
ENV TZ=Asia/Dhaka

RUN apt-get -y update && apt-get -y upgrade && apt-get install -y bash wget curl golang git ttyd nginx tzdata python3 python3-pip \
    && apt-get install -y tzdata \
    && ln -fs /usr/share/zoneinfo/$TZ /etc/localtime \
    && dpkg-reconfigure -f noninteractive tzdata \
    && apt-get -y autoremove && apt-get -y autoclean
RUN curl -fsSL https://raw.githubusercontent.com/filebrowser/get/master/get.sh | bash
RUN curl https://cli-assets.heroku.com/install.sh | sh

RUN pip3 install requests python-dotenv
COPY . .
RUN chmod +x ./script/nginx.sh ./script/xui.sh ./script/fb.sh ./script/ttyd.sh

RUN go mod init webui && go build -o bin/webui
CMD ["./bin/webui"]