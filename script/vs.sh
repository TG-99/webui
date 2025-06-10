#!/bin/bash
wget https://github.com/coder/code-server/releases/download/v4.100.3/code-server-4.100.3-linux-amd64.tar.gz
tar -xzvf code-server-4.100.3-linux-amd64.tar.gz
cp -r code-server-4.100.3-linux-amd64 /usr/lib/code-server
ln -s /usr/lib/code-server/bin/code-server /bin/code-server
rm -r code-server-4.100.3-linux-amd64*

while :
do
code-server --port 8081 --user-data-dir /var/lib/code-server --auth none ./home
done
