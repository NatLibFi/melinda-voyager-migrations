#!/bin/bash
# First run should be done with SKIP turned on to handle bulk of the data. Next run should be done withtout to ensure completeness.
export SKIP_ON_ERROR=1

# Limit to run for just one record
export LIMIT=1000000
export NOOP=0
export NO_INDEX_REMOVAL=1
export DEBUG="*"
#export DEBUG="migration-utils,fix-authority-record"


#TNS_ADMIN=`pwd` LD_LIBRARY_PATH=~/insta/opt/instantclient_12_2/ nohup /home/petuomin/.nvm/versions/node/v7.10.0/bin/node index.js > logs/loki_tuplalinkit.txt &
TNS_ADMIN=`pwd` LD_LIBRARY_PATH=~/insta/opt/instantclient_12_2/ /home/petuomin/.nvm/versions/node/v7.10.0/bin/node index.js 




