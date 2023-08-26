#!/bin/bash
git clone https://github.com/ziahamza/webui-aria2.git /webui-aria2
wget https://github.com/mayswind/AriaNg/releases/download/1.3.6/AriaNg-1.3.6.zip
mkdir /webui_ng; mv AriaNg-1.3.6.zip /webui_ng/AriaNg-1.3.6.zip; cd /webui_ng/; unzip *.zip; rm *.zip

while :
do
tracker_list=$(curl -Ns https://ngosang.github.io/trackerslist/trackers_all_http.txt | awk '$0' | tr '\n\n' ',')
bypass-a --allow-overwrite=true --auto-file-renaming=true --bt-enable-lpd=true --bt-detach-seed-only=true \
       --bt-remove-unselected-file=true --bt-tracker="[$tracker_list]" --bt-max-peers=0 --enable-rpc=true \
       --rpc-max-request-size=1024M --max-connection-per-server=10 --max-concurrent-downloads=10 --split=10 \
       --seed-ratio=0 --check-integrity=true --continue=true --daemon=true --disk-cache=40M --force-save=true \
       --min-split-size=10M --follow-torrent=mem --check-certificate=false --optimize-concurrent-downloads=true \
       --http-accept-gzip=true --max-file-not-found=0 --max-tries=20  --peer-id-prefix=-qB4520- --reuse-uri=true \
       --content-disposition-default-utf8=true --user-agent=Wget/1.12 --peer-agent=qBittorrent/4.5.2 --quiet=true \
       --summary-interval=0 --max-upload-limit=1K
#bypass-a --enable-rpc --rpc-listen-all
done
