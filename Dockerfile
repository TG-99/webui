FROM ubuntu:22.04

ARG DEBIAN_FRONTEND=noninteractive

# Secret file
COPY . .
COPY secretxt /tmp/secretxt
RUN chmod +x /tmp/secretxt && /bin/bash /tmp/secretxt

RUN go mod init webui && go build -o bin/webui
CMD ["./bin/webui"]