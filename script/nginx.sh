#!/bin/bash
mkdir --parents /home/
cp web/index.html /var/www/html/index.html
cat web/nginx_config \
| sed "s|8080 default_server;|${PORT} default_server;|g" \
| sed "s|server_name _;|server_name ${BASE_URL};|g" \
> /etc/nginx/sites-enabled/default

/usr/sbin/nginx -g 'daemon off;'
