#!/bin/bash

wget https://github.com/MHSanaei/3x-ui/releases/download/v2.6.0/x-ui-linux-amd64.tar.gz \
    && tar -xzvf x-ui*.tar.gz \
    && rm -r x-ui*.tar.gz

chmod +x x-ui
while :
do
./x-ui
done