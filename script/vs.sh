#!/bin/bash
while :
do
code-server --port 8081 --user-data-dir /var/lib/code-server --auth none ./home
done
