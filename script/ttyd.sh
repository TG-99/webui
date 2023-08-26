#!/bin/bash
while :
do
ttyd -p 8081 -P 3 -t fontSize=20 -t titleFixed=Web-Terminal_ttyd -t 'theme={"background": "black"}' bash
done
