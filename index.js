// running this requires at least node 7.10.0
/* eslint no-console: 0 */

const _ = require('lodash');
const oracledb = require('oracledb');
const fs = require('fs');
const debug = require('debug')('main');
const MarcRecord = require('marc-record-js');

const ResolveMelindaIdService = require('../../lib/record-id-resolution-service');
const RecordUtils = require('../../lib/record-utils');
const MigrationUtils = require('./migration-utils');
const fixAuthorityRecordYears = require('./fix-authority-record');
const AlephRecordService = require('../../lib/aleph-record-service');
const voyagerRecordService = require('./voyager-record-service');
const TimeEstimation = require('./time-estimation');
const utils = require('./utils');

const Constants = require('./constants');
const TASK_TYPES = Constants.TASK_TYPES;

const USE_CACHE = false;
const MELINDA_SAVE_PARALLELIZATION = 10;
const MELINDA_RESOLVE_PARALLELIZATION = 20;

// migrate only LIMIT fennica auths
const LIMIT = parseInt(utils.readEnvironmentVariable('LIMIT', -1));
const SKIP_ON_ERROR = utils.readEnvironmentVariable('SKIP_ON_ERROR', false) !== false;

//const WAIT_ON_ERROR_SECONDS = 60;
const WAIT_ON_ERROR_SECONDS = 2;

const dbConfig = require('./dbconfig.js');

const atFile = '../fenni-asteri-iterator.txt';
//const listFile = '../fenni-asteri.list';
//const listFile = '';

let startAt;
let list =[];

oracledb.outFormat = oracledb.OBJECT;

const ALEPH_URL = 'http://melinda.kansalliskirjasto.fi';
const X_SERVER_URL = `${ALEPH_URL}/X`;

const alephRecordService = AlephRecordService.createAlephRecordService(X_SERVER_URL);

let resolveMelindaId = ResolveMelindaIdService.create(X_SERVER_URL, ALEPH_URL, 'fin01');
let resolveAsteriId = ResolveMelindaIdService.create(X_SERVER_URL, ALEPH_URL, 'fin11');

const TaskHandler = require('./task-handler');
const createLinkings = new TaskHandler(alephRecordService, voyagerRecordService);

const DEBUG_SQL = process.env.DEBUG_SQL;

const estimation = TimeEstimation.create();

const IS_BATCH_RUN = process.argv.length !== 3;

function m(key, orig) {
  const cachePath = require('path').join(__dirname, '..', 'cache', key);
  const memoize = require('memoize-fs')({ cachePath: cachePath });
  return function() {
    const args = arguments;
    return memoize.fn(orig).then(memod => {
      return memod.apply(null, args);
    });
  };
}
function mrec(key, orig) {
  const cachePath = require('path').join(__dirname, '..', 'cache', key);
  const memoize = require('memoize-fs')({ cachePath: cachePath });
  return function() {
    const args = arguments;
    return memoize.fn(orig).then(memod => {
      return memod.apply(null, args).then(rec => new MarcRecord(rec));
    });
  };
}

if (USE_CACHE) {
  /*eslint-disable */
  voyagerRecordService.readAuthorityRecord = mrec('voyagerRecordService.readAuthorityRecord', voyagerRecordService.readAuthorityRecord);
  alephRecordService.loadRecord = mrec('alephRecordService.loadRecord', alephRecordService.loadRecord);
  voyagerRecordService.readBibRecord = mrec('voyagerRecordService.readBibRecord', voyagerRecordService.readBibRecord);

  resolveQuery = m('resolveQuery', resolveQuery);
  headingIdsToBibIds = m('headingIdsToBibIds', headingIdsToBibIds);
  queryFuzzy = m('queryFuzzy', queryFuzzy);
  queryForLinkedAuthorityRecords = m('queryForLinkedAuthorityRecords', queryForLinkedAuthorityRecords);
  queryFromIndices = m('queryFromIndices', queryFromIndices);
  resolveAsteriId = m('resolveAsteriId', resolveAsteriId);
  resolveMelindaId = m('resolveMelindaId', resolveMelindaId);
  /*eslint-enable */
  
}

let executionStopRequested = false;
process.on('SIGTERM', () => {
  console.log('SIGTERM received, stopping after current record');
  executionStopRequested = true;
});

start();
let count = 0;

function runner(lastAuthorityRecordId) {

  return async function next(connection, resultSet, row) {
    if (row === null) {
      console.log('Done.');
      return;
    }
    if (executionStopRequested) {
      console.log('Stopping as requested');
      return;
    }
      
    let skipped = false;  
    try {

      if (list == null) {  	

	  await queryForAuthId(connection, row.AUTH_ID);

      }
      else {

	  if (_.findIndex(list, function(o) { return o == row.AUTH_ID;}) >= 0) {
	      console.log("DEBUG: auth_id  is on list, index: "+_.findIndex(list, function(o) { return o == row.AUTH_ID; }));
	      await queryForAuthId(connection, row.AUTH_ID);
	  }
	  else {
	      console.log(`DEBUG: auth_id ${row.AUTH_ID} not on list, skipping!`);
	      skipped = true;
	  }

      }

	const percentDone = parseInt(row.AUTH_ID) / parseInt(lastAuthorityRecordId) * 100;
	const percentDone2Decimals = Math.floor(percentDone*100)/100;
	console.log(`INFO Handling authority record ${row.AUTH_ID} / ${lastAuthorityRecordId} (${percentDone2Decimals}%) (Current time: ${Date().toString()})`);
	const start = process.hrtime();
	


      const elapsed = estimation.elapsedTime(start, 'FENAU record');
      const recordsToHandle = parseInt(lastAuthorityRecordId) - parseInt(row.AUTH_ID);
      const { timeEstimate, readyEstimate } = estimation.getEstimations(recordsToHandle);
      console.log(`DEBUG: Processing record took ${elapsed} seconds. Time to complete: ${estimation.secondsToTimeString(timeEstimate)}. Ready at ${readyEstimate.toString()}`);

      
      fs.writeFileSync(atFile, row.AUTH_ID);
      
      if (!skipped) {	
	count++;
      }

      if (count === LIMIT) {
        console.log(`The migration was limited to ${LIMIT} items. Stopping.`);
        return;
      }

      if (list && Math.max(...list) < row.AUTH_ID) {
	  console.log(`List handled. Stopping.`);
	  return;
      }	

      const nextRow = await resultSet.getRow();
      next(connection, resultSet, nextRow);

    } catch(error) {
      console.log('SYSTEM-ERROR', error.message, error);
      
      console.log(`DEBUG: restart in ${WAIT_ON_ERROR_SECONDS} seconds`);
      if (SKIP_ON_ERROR) {
        const failedAuthId = parseInt(row.AUTH_ID);
        console.log(`WARN: Skipping failed record ${failedAuthId}`);
        fs.writeFileSync(atFile, failedAuthId+1);
      }

      setTimeout(() => {
        start();
      }, WAIT_ON_ERROR_SECONDS * 1000);

    }
    
  };
}

function start() {
    
  try {
    list = fs.readFileSync(listFile, 'utf-8').toString().split("\n");
    list = list.filter(Number);
    list = list.sort((a, b) => a - b);
    console.log("LIST: "+list);  
  }
    catch(error) {
    if (error && error.code !== 'ENOENT') {
      console.log(error);
    }
    console.log('DEBUG: List file not found. Checking all authority records.');
    list = undefined;
  }

    
  try {
    startAt = parseInt(fs.readFileSync(atFile, 'utf-8'));

  } catch(error) {
    if (error && error.code !== 'ENOENT') {
      console.log(error);
    }
    console.log('DEBUG: Iterator file not found. Starting from beginning.');
    startAt = 0;
  }

  if (list){
      if (startAt < list[0]) {
	  startAt = list[0]-1;
	  console.log('DEBUG: Starting from first listed id: '+startAt);
      }  
  }

  debug('connecting to oracle', dbConfig);
  oracledb.getConnection(dbConfig)
    .then(async connection => {

      if (DEBUG_SQL) {
        utils.decorateConnectionWithDebug(connection);
      }
    
      if (process.argv.length === 3) {
        const auth_id = process.argv[2];
        return await queryForAuthId(connection, auth_id);
      }

      const maxResult = await connection.execute('select max(AUTH_ID) as last_auth_id from fennicadb.AUTH_DATA', []);
      const lastAuthorityRecordId = _.get(maxResult, 'rows[0].LAST_AUTH_ID');
      



	let result;


      if (list != null && list != undefined && list.length < 1000) {

	  if (! startAt > 0) { startAt = 0};

     let list_sql = "select distinct AUTH_ID from fennicadb.AUTH_DATA where AUTH_ID in (";
	for (var i=0; i < list.length; i++) list_sql += (i > 0) ? ", :" + i : ":" + i;
	list_sql += ") and AUTH_ID > "+startAt+" order by AUTH_ID";

	console.log(list_sql);		

          result = await connection.execute(list_sql, list, {resultSet: true});

      }

	else {


	  result = await connection.execute('select distinct AUTH_ID from fennicadb.AUTH_DATA where AUTH_ID > :startAt order by AUTH_ID', [startAt], {resultSet: true});

	}
      const resultSet = result.resultSet;

      const nextRow = await resultSet.getRow();
      return runner(lastAuthorityRecordId)(connection, resultSet, nextRow);

    }).catch(error => {
      if (error instanceof TypeError) {
        console.error(error);
        return;
      }

      console.log('SYSTEM-ERROR', error.message, error);

      if (IS_BATCH_RUN) {
        console.log(`DEBUG: restart in ${WAIT_ON_ERROR_SECONDS} seconds`);
      
        setTimeout(() => {
          start();
        }, WAIT_ON_ERROR_SECONDS * 1000);
      }
    });
}

async function queryForAuthId(connection, auth_id) {
  debug('queryForAuthId', auth_id);
  const tasks = await authIdToTasks(connection, auth_id);
  debug(`Number of tasks to handle ${tasks.length}`);

  const [melindaTasks, fenniTasks] = _.partition(tasks, isMelindaTask);

  // chunk fennitasks to ensure that they are saved only once.
  const fenniGroupedByTypeAndId = utils.chunkWith(fenniTasks, (a, b) => {
    return a.type === b.type && a.type === TASK_TYPES.FENNI_ASTERI && a.bib_id === b.bib_id;
  });

  for (let taskList of fenniGroupedByTypeAndId) {
    taskList = taskList.filter(task => task !== undefined);
    if (taskList.length > 0) {
      await createLinkings(taskList, _.head(taskList).type);
    }
  }

  // group tasks for same type and id to ensure they are saved only once.
  const groupedByTypeAndId = utils.chunkWith(melindaTasks, (a, b) => {
    return a.type === b.type && a.type === TASK_TYPES.MELINDA_ASTERI && a.melindaId === b.melindaId;
  });

  const taskGroups = _.chunk(groupedByTypeAndId, MELINDA_SAVE_PARALLELIZATION);
  for (let parallelTasks of taskGroups) {
    
    await Promise.all(parallelTasks.map(taskList => {
      taskList = taskList.filter(task => task !== undefined);

      if (taskList.length > 0) {
        return createLinkings(taskList, _.head(taskList).type);
      }
    }));
  }
  
}

function isMelindaTask(task) {
  if (task.type === TASK_TYPES.LINKED_ASTERI_ASTERI) return true;
  if (task.type === TASK_TYPES.ASTERI_ASTERI) return true;
  if (task.type === TASK_TYPES.MELINDA_ASTERI) return true;
  return false;
}

async function authIdToTasks(connection, auth_id) {
  try {

    const authorityRecord = await voyagerRecordService.readAuthorityRecord(connection, auth_id);

    if (!RecordUtils.recordIsAgentAuthority(authorityRecord)) {
      console.log(`DEBUG FENAU auth_id ${auth_id} \t Record is not an agent authority. Skipping.`);
      return [];
    }

    const links = RecordUtils.selectMelindaLinks(authorityRecord, '(FI-ASTERI-N)');
    debug('resolveAsteriId', auth_id);
    const asteriId = await resolveAsteriId(undefined, auth_id, ' FENAU', links);
    
    const queryTermsForFieldSearch = MigrationUtils.selectNameHeadingPermutations(authorityRecord);
    const queryTermsString = queryTermsForFieldSearch.map(sets => sets.map(sub => `‡${sub.code}${sub.value}`));

    const authorityRecordHas100 = authorityRecord.getFields('100').length === 1;
    const fixedAuthorityRecord = authorityRecordHas100 ? fixAuthorityRecordYears(authorityRecord) : authorityRecord;

    const fenauFixTask = {
      type: TASK_TYPES.FENAU_ASTERI,
      fenauRecord: authorityRecord
    };

    debug('loading asteri record', asteriId);
    const asteriRecord = await alephRecordService.loadRecord('FIN11', asteriId);

    const asteriFixTask = {
      type: TASK_TYPES.ASTERI_ASTERI,
      asteriRecord: asteriRecord
    };
    
    const authorityTasks = async () => {
      debug('Resolving tasks for linking fenau - asteri');
      const fenauAsteriTasks = await findFenauAsteriLinkingTasks(connection, auth_id);
      debug('Resolving tasks for linking asteri - asteri');
      const asteriAsteriLinks = await findAsteriAsteriLinkingTasks(connection, fenauAsteriTasks);

      return {fenauAsteriTasks, asteriAsteriLinks};
    };

    const bibTasks = async() => {
      debug('Resolving tasks for linking fenni - asteri');
      const fenniAsteriTasks = await findFenniAsteriLinkingTasks(connection, auth_id);

      debug('Resolving tasks for linking melinda - asteri', fenniAsteriTasks.length);
      const melindaAsteriTasks = await findMelindaAsteriLinkingTasks(connection, fenniAsteriTasks);
      

      return {fenniAsteriTasks, melindaAsteriTasks};
    };

    const tasks = await Promise.all([authorityTasks(), bibTasks()]);
    const { fenauAsteriTasks, fenniAsteriTasks, asteriAsteriLinks, melindaAsteriTasks } = tasks.reduce((acc, task) => _.assign(acc, task), {});

    return _.concat([fenauFixTask], [asteriFixTask], fenauAsteriTasks, fenniAsteriTasks, asteriAsteriLinks, melindaAsteriTasks)
      .map(task => {
        return Object.assign({}, task, {
          asteriIdForLinking: asteriId,
          queryTermsForFieldSearch, 
          queryTermsString, 
          fixedAuthorityRecord,
          fenauRecordId: auth_id
        });
      });

  } catch(error) {
    if (isSystemError(error)) {
      throw error;
    }
    
    if (error && error instanceof ResolveMelindaIdService.ParseError) {
      throw error;
    }
    
    console.log(`ERROR FENAU auth_id ${auth_id} \t ${error.message}`);
    const authorityRecord = await voyagerRecordService.readAuthorityRecord(connection, auth_id);
    console.log('FENAU:');
    console.log(authorityRecord.toString());
    return [];
  }
}

async function findMelindaAsteriLinkingTasks(connection, fenniAsteriTasks) {

  const fennicaBibIds = fenniAsteriTasks.map(task => task.bib_id);

  const melindaAsteriTasks = [];
  
  const fennicaBibIdGroups = _.chunk(fennicaBibIds, MELINDA_RESOLVE_PARALLELIZATION);
  
  for (let bibIdGroup of fennicaBibIdGroups) {

    await Promise.all(bibIdGroup.map(async(bib_id) => {
      debug(`findMelindaAsteriLinkingTasks for ${bib_id}`);
      try  {
        const fennicaRecord = await voyagerRecordService.readBibRecord(connection, bib_id);

        const links = RecordUtils.selectMelindaLinks(fennicaRecord);
        const melindaId = await resolveMelindaId(undefined, bib_id, 'FENNI', links);
        const melindaRecord = await alephRecordService.loadRecord('FIN01', melindaId);

        melindaAsteriTasks.push({
          type: TASK_TYPES.MELINDA_ASTERI,
          melindaRecord,
          melindaId
        });

      } catch(error)  {
        if (isSystemError(error)) {
          throw error;
        }
        console.log(`ERROR FENNI bib_id ${bib_id} \t ${error.message}`);
      }
    }));
  }

  return _.compact(melindaAsteriTasks);

}

async function findAsteriAsteriLinkingTasks(connection, fenauAsteriTasks) {

  const linkedAuthorityRecordIds = fenauAsteriTasks.map(task => task.linkedFenauRecordId);
  const linkedAsteriIds = await Promise.all(linkedAuthorityRecordIds.map(async linkedAuthorityRecordId => {
    try {
      const record = await voyagerRecordService.readAuthorityRecord(connection, linkedAuthorityRecordId);
      if (!RecordUtils.recordIsAgentAuthority(record)) {
        console.log(`DEBUG FENAU auth_id ${linkedAuthorityRecordId} \t Record is not an agent authority. Skipping.`);
        return undefined;
      }
      
      const links = RecordUtils.selectMelindaLinks(record, '(FI-ASTERI-N)');
      const linkedRecordAsteriId = await resolveAsteriId(undefined, linkedAuthorityRecordId, ' FENAU', links);
      return linkedRecordAsteriId;
    } catch(error) {
      if (isSystemError(error)) {
        throw error;
      }
      
      console.log(`ERROR FENAU auth_id ${linkedAuthorityRecordId} \t ${error.message}`);
    }
  }));

  const asteriasteriLinks = await Promise.all(_.compact(linkedAsteriIds).map(async linkedAsteriId => {

    const linkedAsteriRecord = await alephRecordService.loadRecord('FIN11', linkedAsteriId);

    return {
      type: TASK_TYPES.LINKED_ASTERI_ASTERI,
      linkedAsteriRecord: linkedAsteriRecord,
      linkedAsteriId: linkedAsteriId
    };
  }));

  return asteriasteriLinks;
}

async function findFenauAsteriLinkingTasks(connection, auth_id) {

  // linked authority records
  const linkedAuthorityRecordIds = await queryForLinkedAuthorityRecords(connection, auth_id);

  const linkedFenauLinks = await Promise.all(linkedAuthorityRecordIds.map(async (linkedAuthorityRecordId) => {

    const linkedAuthorityRecord = await voyagerRecordService.readAuthorityRecord(connection, linkedAuthorityRecordId);

    return {
      type: TASK_TYPES.LINKED_FENAU_ASTERI,
      linkedFenauRecord: linkedAuthorityRecord,
      linkedFenauRecordId: linkedAuthorityRecordId,
      fenauRecordId: auth_id
    };
  }));

  return linkedFenauLinks;

}

async function findFenniAsteriLinkingTasks(connection, auth_id) {

  const fenniBibIds = await queryFromIndices(connection, auth_id);

  debug(`Number of possible records to link (${fenniBibIds.length})`);

  const fenniLinks = await serialDropErrors(fenniBibIds.map((fenniBibId => async () => {
    const bibRecord = await voyagerRecordService.readBibRecord(connection, fenniBibId);

    return {
      type: TASK_TYPES.FENNI_ASTERI,
      bib_id: fenniBibId, 
      bibRecord
    };
  })));

  const fuzzyQueryFenniBibIds = await queryFuzzy(connection, auth_id);
  const fuzzyTasksWithoutIndiceTasks = _.difference(fuzzyQueryFenniBibIds, fenniBibIds);

  const fuzzyFenniLinks = await Promise.all(fuzzyTasksWithoutIndiceTasks.map(async (bib_id) => {
    
    const bibRecord = await voyagerRecordService.readBibRecord(connection, bib_id);

    return {
      type: TASK_TYPES.FENNI_ASTERI,
      bib_id, 
      bibRecord
    };
  }));

  return _.concat(fenniLinks, fuzzyFenniLinks);

}


function serialDropErrors(funcs) {
  return funcs.reduce((promise, func) => {
    return new Promise((resolve) => {
      promise.then((all) => {
        func()
          .then(result => resolve(_.concat(all, result)))
          .catch(error => {
            console.log('SYSTEM-ERROR', error.message, error);
            resolve(all);
          });
      });
    });
  }, Promise.resolve([]));
}


async function queryForLinkedAuthorityRecords(connection, auth_id) {

  const sql = `
select distinct (auth_id) from fennicadb.auth_heading
where 
(heading_id_pointee in (
  select heading_id_pointer
  from fennicadb.auth_heading
  where auth_id = :auth_id)
or
heading_id_pointer in (
  select heading_id_pointee
  from fennicadb.auth_heading
  where auth_id = :auth_id)
) and auth_id != :auth_id
`;

  const result = await connection.execute(sql, [auth_id], {resultSet: true});
  const rows = await utils.readAllRows(result.resultSet);

  const linkedAuthorityRecordIds = rows.map(row => row.AUTH_ID);
  return linkedAuthorityRecordIds;
}

async function queryFromIndices(connection, auth_id) {
  // find from XXX the bibs that are linked by voyager

  const result = await connection.execute('SELECT HEADING_ID_POINTER, HEADING_ID_POINTEE, REFERENCE_TYPE FROM FENNICADB.AUTH_HEADING where AUTH_ID = :id and reference_type IN (\'A\', \'N\', \'s\')', [auth_id], {resultSet: true});
  const rows = await utils.readAllRows(result.resultSet);

  const headingIds = _.uniq(_.flatMap(rows, (row) => {
    return [row.HEADING_ID_POINTER, row.HEADING_ID_POINTEE].filter(item => item !== 0);
  }));

  const lookup = await headingIdsToBibIds(connection, headingIds);
  
  const tasks = headingIds.map(heading_id => {
    const bib_id = lookup[heading_id];
    if (bib_id === undefined) {
      return;
    }

    return bib_id;
    
  });

  return _.compact(_.flatten(tasks));

}

async function queryFuzzy(connection, auth_id) {

  const result = await connection.execute('SELECT * FROM FENNICADB.AUTH_INDEX where AUTH_ID = :id', [auth_id], {resultSet: true});
  const rows = await utils.readAllRows(result.resultSet);

  const name = rows.find(row => row.INDEX_CODE === 'A100');
  const birth = rows.find(row => row.INDEX_CODE === 'A46F');
  const death = rows.find(row => row.INDEX_CODE === 'A46G');

  if (name === undefined) {
    return;
  }

  const permuted = [name, birth, death].filter(_.identity).map(row => row.NORMAL_HEADING);
  
  const perms = permuted.map((item, index) => permuted.slice(0, index+1));
  const queryTerms = perms.map(perm => perm.join(' '));

  const resultsit = await Promise.all(queryTerms.map(term => resolveQuery(connection, term)));

  const tasks = _.flatten(resultsit);

  return tasks.filter(_.identity);

}

async function headingIdsToBibIds(connection, listOfHeadingIds) {
  if (listOfHeadingIds.length === 0) {
    return {};
  }

  const inClause = listOfHeadingIds.map((val, i) => `:v${i}`);

  const sql = `SELECT HEADING_ID, BIB_ID FROM FENNICADB.BIB_HEADING where HEADING_ID IN (${inClause})`;
  
  const result = await connection.execute(sql, listOfHeadingIds, {resultSet: true});
  const rows = await utils.readAllRows(result.resultSet);

  const lookup = rows.reduce((acc, obj) => {

    acc[obj.HEADING_ID] = _.chain(acc[obj.HEADING_ID]).concat(obj.BIB_ID).compact().value();
    return acc;
  },{});

  return lookup;
    
}

function resolveQuery(connection, queryTerm) {

  return connection.execute('SELECT * FROM FENNICADB.HEADING where NORMAL_HEADING = :query', [queryTerm], {resultSet: true})
  .then(result => {
    return utils.readAllRows(result.resultSet);
  }).then(rows => {
    const headingIds = rows
      .filter(row => row.INDEX_TYPE === 'N')
      .filter(row => row.HEADING_TYPE === 'p')
      .map(row => row.HEADING_ID);

    return headingIdsToBibIds(connection, headingIds).then(lookup => {

      return headingIds.map(headingId => {
        const bib_id = lookup[headingId];

        return bib_id;
      });
      
    }).then(lists => _.flatten(lists));

  });
}

function isSystemError(error) {
  if (error instanceof TypeError) {
    return true;
  }
  if (error && error.code && error.code === 'ECONNREFUSED') {
    return true;
  }
  if (error && error.code && error.code === 'ECONNRESET') {
    return true;
  }
  if (error && error.code && error.code === 'EMFILE') {
    return true;
  }
  if (error && error.code && error.code === 'ETIMEDOUT') {
    return true;
  }
  if (error && error.code && error.code === 'EPIPE') {
    return true;
  }
  return false;
}

// utility function for validatng the record-utils normalizer against voyager normalization.
async function validateNormalizationFunction(connection) {

  const result = await connection.execute('SELECT AUTH_ID, utl_raw.CAST_TO_RAW(NORMAL_HEADING) as NH, utl_raw.CAST_TO_RAW(DISPLAY_HEADING) as DH FROM FENNICADB.AUTH_INDEX where INDEX_CODE=:id', ['A100'], {resultSet: true});
  const resultSet = result.resultSet;
  
  nextFrom(resultSet);
}

async function nextFrom(resultSet) {

  const row = await resultSet.getRow();
  if (row) {
    
    const NORMAL_FROM_DB = row.NH.toString('utf-8');
    const DISPLAY_FROM_DB = row.DH.toString('utf-8');

    const NORMAL_FROM_UTILS = MigrationUtils.normalizeForHeadingQuery(DISPLAY_FROM_DB);

    if (NORMAL_FROM_UTILS !== NORMAL_FROM_DB) {
      console.log(`${row.AUTH_ID}\t${DISPLAY_FROM_DB} -> '${NORMAL_FROM_UTILS}' should be '${NORMAL_FROM_DB}'`);
      const utilsChars = NORMAL_FROM_UTILS.split('');
      const dbChars = NORMAL_FROM_DB.split('');
      console.log(_.zip(utilsChars, dbChars).find(pair => pair[0] !== pair[1]));
    }
    nextFrom(resultSet);
  }
}
