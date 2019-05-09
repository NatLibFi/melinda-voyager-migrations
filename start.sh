#!/bin/bash
# First run should be done with SKIP turned on to handle bulk of the data. Next run should be done withtout to ensure completeness.
export SKIP_ON_ERROR=1
export NOOP=0
export LIMIT=-1
export NO_INDEX_REMOVAL=1
#export DEBUG="migration-utils,fix-authority-record,record-utils"
#export DEBUG="aleph-record-service"
#export DEBUG="*"

TNS_ADMIN=`pwd` LD_LIBRARY_PATH=~/insta/opt/instantclient_12_2/ nohup /home/petuomin/.nvm/versions/node/v7.10.0/bin/node index.js >> logs/loki_fennica_rerun_20190107.txt &
#TNS_ADMIN=`pwd` LD_LIBRARY_PATH=~/insta/opt/instantclient_12_2/ /home/petuomin/.nvm/versions/node/v7.10.0/bin/node index.js 

