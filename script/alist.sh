#!/bin/bash
wget https://github.com/alist-org/alist/releases/download/v3.35.0/alist-linux-amd64.tar.gz
tar -xzvf alist-linux*.tar.gz
rm -r alist-linux*.tar.gz

while :
do
./alist server --no-prefix
done
