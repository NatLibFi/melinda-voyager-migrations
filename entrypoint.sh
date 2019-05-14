#!/bin/sh
sed \
  -e "s/%/|/g" \
  -e "s/|PROTOCOL|/$ORACLE_PROTOCOL/g" \
  -e "s/|PORT|/$ORACLE_PORT/g" \
  -e "s/|ALEPH_HOST|/$ALEPH_ORACLE_HOST/g" \
  -e "s/|ALEPH_SID|/$ALEPH_ORACLE_SID/g" \
  -e "s/|VOYAGER_HOST|/$VOYAGER_ORACLE_HOST/g" \
  -e "s/|VOYAGER_SID|/$VOYAGER_ORACLE_SID/g" \
  tnsnames.ora.template > tnsnames.ora

if [ -n $WALLET_DIRECTORY ];then
  sed \
    -e "s/%/_/g" \
    -e "s|_WALLET_DIRECTORY_|$ORACLE_WALLET_DIRECTORY|g" \
    -e "s|_CONNECT_TIMEOUT_|$ORACLE_CONNECT_TIMEOUT|g" \
    sqlnet.ora.template > sqlnet.ora
fi

exec $@
