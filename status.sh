#!/bin/bash

PID=`ps aux | grep "node index" | grep petuomin | grep -v grep | awk '{$1=$1;print}' | cut -d' ' -f 2`
if [ -z "$PID" ]; then
  echo "Stopped"
  exit 0
fi
echo "Running"

