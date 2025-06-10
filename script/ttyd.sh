#!/bin/bash
while :
do
ttyd -p 8090 -P 3 -t fontSize=18 -t titleFixed=Web-Terminal_ttyd -t 'theme={"background": "black"}' bash
done
