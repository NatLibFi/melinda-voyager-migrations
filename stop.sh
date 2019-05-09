#!/bin/bash

PID=`ps aux | grep "node index" | grep petuomin | grep -v grep | awk '{$1=$1;print}' | cut -d' ' -f 2`
echo "Killing $PID"

kill -9 $PID

