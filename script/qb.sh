#!/bin/bash
wget -O /qBittorrent/vuetorrent.zip https://github.com/WDaan/VueTorrent/releases/latest/download/vuetorrent.zip 
cd /qBittorrent/; unzip *.zip; rm *.zip
mv /qBittorrent/vuetorrent /qBittorrent/webui

while :
do
bypass-q --profile=/ --webui-port=8089
done
