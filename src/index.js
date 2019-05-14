/**
* Copyright 2017, 2019 University Of Helsinki (The National Library Of Finland)
*
* Licensed under the Apache License, Version 2.0 (the "License");
* you may not use this file except in compliance with the License.
* You may obtain a copy of the License at
*
*     http://www.apache.org/licenses/LICENSE-2.0
*
* Unless required by applicable law or agreed to in writing, software
* distributed under the License is distributed on an "AS IS" BASIS,
* WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
* See the License for the specific language governing permissions and
* limitations under the License.
*/

import _ from 'lodash';
import oracledb from 'oracledb';
import fs from 'fs';
import createDebugLogger from 'debug';
import MarcRecord from 'marc-record-js';
import resolveMelindaIdServiceFactory, {ParseError} from './record-id-resolution-service';
import * as RecordUtils from './record-utils';
import * as MigrationUtils from './migration-utils';
import fixAuthorityRecordYears from './fix-authority-record';
import createAlephRecordService from './aleph-record-service';
import createVoyagerRecordService from './voyager-record-service';
import createTimeEstimation from './time-estimation';
import createTaskHandler from './task-handler';
import {readEnvironmentVariable, decorateConnectionWithDebug, chunkWith, readAllRows} from './utils';
import * as Constants from './constants';
import HEADING_RELATOR_STRINGS from './heading-relator-strings';

process.on('uncaughtException', handleException);
process.on('unhandledRejection', handleException);
process.on('SIGINT', handleException);

run();

function handleException(err) {
	console.log(typeof err === 'object' && 'stack' in err ? err.stack : err);
	process.exit(1);
}

async function run() {
	const {
		ITERATOR_FILE, LIST_FILE,
		MELINDA_SID_BIB, MELINDA_SID_AUT,
		ALEPH_LIBRARY_AUTH_NAMES, ALEPH_LIBRARY_BIB,
		VOYAGER_ORACLE_USERNAME, VOYAGER_ORACLE_PASSWORD,
		VOYAGER_DB_NAME, VOYAGER_API_URL, VOYAGER_API_KEY,
		X_SERVER_URL,
		DEBUG_SQL, LIMIT, SKIP_ON_ERROR
	} = getEnv();

	oracledb.outFormat = oracledb.OBJECT;
	oracledb.queueTimeout = 10000;

	const debug = createDebugLogger('melinda-voyager-migrations:main');

	const TASK_TYPES = Constants.TASK_TYPES;

	const USE_CACHE = false;
	const MELINDA_SAVE_PARALLELIZATION = 10;
	const MELINDA_RESOLVE_PARALLELIZATION = 20;

	// Const WAIT_ON_ERROR_SECONDS = 60;
	const WAIT_ON_ERROR_SECONDS = 2;

	const dbConfig = {
		connectString: 'VOYAGER',
		user: VOYAGER_ORACLE_USERNAME,
		password: VOYAGER_ORACLE_PASSWORD
	};

	const atFile = ITERATOR_FILE;
	const listFile = LIST_FILE;

	const alephRecordService = createAlephRecordService(X_SERVER_URL);
	const voyagerRecordService = createVoyagerRecordService({url: VOYAGER_API_URL, apiKey: VOYAGER_API_KEY});
	const createLinkings = createTaskHandler(alephRecordService, voyagerRecordService);

	const estimation = createTimeEstimation();
	const IS_BATCH_RUN = process.argv.length !== 3;

	let startAt;
	let list = [];
	let count = 0;
	let executionStopRequested = false;

	let resolveMelindaId = resolveMelindaIdServiceFactory(X_SERVER_URL, ALEPH_LIBRARY_BIB);
	let resolveAsteriId = resolveMelindaIdServiceFactory(X_SERVER_URL, ALEPH_LIBRARY_AUTH_NAMES);

	process.on('SIGTERM', () => {
		console.log('SIGTERM received, stopping after current record');
		executionStopRequested = true;
	});

	if (USE_CACHE) {
		/* eslint-disable */
		voyagerRecordService.readAuthRecord = mrec('voyagerRecordService.readAuthRecord', voyagerRecordService.readAuthecord);
		alephRecordService.loadRecord = mrec('alephRecordService.loadRecord', alephRecordService.loadRecord);
		voyagerRecordService.readBibRecord = mrec('voyagerRecordService.readBibRecord', voyagerRecordService.readBibRecord);
		
		resolveQuery = m('resolveQuery', resolveQuery);
		headingIdsToBibIds = m('headingIdsToBibIds', headingIdsToBibIds);
		queryFuzzy = m('queryFuzzy', queryFuzzy);
		queryForLinkedAuthorityRecords = m('queryForLinkedAuthorityRecords', queryForLinkedAuthorityRecords);
		queryFromIndices = m('queryFromIndices', queryFromIndices);
		resolveAsteriId = m('resolveAsteriId', resolveAsteriId);
		resolveMelindaId = m('resolveMelindaId', resolveMelindaId);
		/* eslint-enable */
	}

	start();

	function getEnv() {
		return {
			MELINDA_SID_BIB: readEnvironmentVariable('MELINDA_SID_BIB'),
			MELINDA_SID_AUT: readEnvironmentVariable('MELINDA_SID_AUT'),
			ITERATOR_FILE: readEnvironmentVariable('ITERATOR_FILE'),
			LIST_FILE: readEnvironmentVariable('LIST_FILE'),
			ALEPH_LIBRARY_AUTH_NAMES: readEnvironmentVariable('ALEPH_LIBRARY_AUTH_NAMES'),
			ALEPH_LIBRARY_BIB: readEnvironmentVariable('ALEPH_LIBRARY_BIB'),
			VOYAGER_DB_NAME: readEnvironmentVariable('VOYAGER_DB_NAME'),
			VOYAGER_ORACLE_USERNAME: readEnvironmentVariable('VOYAGER_ORACLE_USERNAME'),
			VOYAGER_ORACLE_PASSWORD: readEnvironmentVariable('VOYAGER_ORACLE_PASSWORD'),
			VOYAGER_API_URL: readEnvironmentVariable('VOYAGER_API_URL'),
			VOYAGER_API_KEY: readEnvironmentVariable('VOYAGER_API_KEY'),
			X_SERVER_URL: readEnvironmentVariable('X_SERVER_URL'),
			DEBUG_SQL: readEnvironmentVariable('DEBUG_SQL'),
			// Migrate only LIMIT fennica auths
			LIMIT: parseInt(readEnvironmentVariable('LIMIT', -1)),
			SKIP_ON_ERROR: readEnvironmentVariable('SKIP_ON_ERROR', false)
		};
	}

	function m(key, orig) {
		const cachePath = require('path').join(__dirname, '..', 'cache', key);
		const memoize = require('memoize-fs')({cachePath: cachePath});
		return function () {
			const args = arguments;
			return memoize.fn(orig).then(memod => {
				return memod.apply(null, args);
			});
		};
	}

	function mrec(key, orig) {
		const cachePath = require('path').join(__dirname, '..', 'cache', key);
		const memoize = require('memoize-fs')({cachePath: cachePath});
		return function () {
			const args = arguments;
			return memoize.fn(orig).then(memod => {
				return memod.apply(null, args).then(rec => new MarcRecord(rec));
			});
		};
	}

	async function start() {
		let connection;

		try {
			list = fs.readFileSync(listFile, 'utf-8').toString().split('\n') // eslint-disable-line require-atomic-updates
				.filter(Number)
				.sort((a, b) => a - b);

			console.log('LIST: ' + list);
		} catch (error) {
			if (error && error.code !== 'ENOENT') {
				console.log(error);
			}

			console.log('DEBUG: List file not found. Checking all authority records.');
			list = undefined;
		}

		if (!atFile) {
			throw new Error('ITERATOR_FILE must be a path');
		}

		try {
			startAt = parseInt(fs.readFileSync(atFile, 'utf-8')); // eslint-disable-line require-atomic-updates
		} catch (error) {
			if (error && error.code !== 'ENOENT') {
				console.log(error);
			}

			console.log('DEBUG: Iterator file not found. Starting from beginning.');
			startAt = 0;
		}

		if (list) {
			if (startAt < list[0]) {
				startAt = list[0] - 1;
				console.log('DEBUG: Starting from first listed id: ' + startAt);
			}
		}

		try {
			debug('connecting to Voyager Oracle');

			connection = await oracledb.getConnection(dbConfig);

			if (DEBUG_SQL) {
				decorateConnectionWithDebug(connection);
			}

			const maxResult = await connection.execute(`select max(AUTH_ID) as last_auth_id from ${VOYAGER_DB_NAME}.AUTH_DATA`, []);
			const lastAuthorityRecordId = _.get(maxResult, 'rows[0].LAST_AUTH_ID');

			let result;

			if (list != null && list != undefined && list.length < 1000) {
				if (!startAt > 0) {
					startAt = 0;
				}

				let list_sql = `select distinct AUTH_ID from ${VOYAGER_DB_NAME}.AUTH_DATA where AUTH_ID in (`;
				for (var i = 0; i < list.length; i++) {
					list_sql += (i > 0) ? ', :' + i : ':' + i;
				}

				list_sql += ') and AUTH_ID > ' + startAt + ' order by AUTH_ID';

				console.log(list_sql);

				result = await connection.execute(list_sql, list, {resultSet: true});
			} else {
				result = await connection.execute(`select distinct AUTH_ID from ${VOYAGER_DB_NAME}.AUTH_DATA where AUTH_ID > :startAt order by AUTH_ID`, [startAt], {resultSet: true});
			}

			const resultSet = result.resultSet;
			const nextRow = await resultSet.getRow();

			return runner(lastAuthorityRecordId)(connection, resultSet, nextRow);
		} catch (error) {
			if (error instanceof TypeError) {
				console.error(error);

				if (connection) {
					await connection.close();
				}

				return;
			}

			console.log('SYSTEM-ERROR', error.message, error);

			if (IS_BATCH_RUN) {
				console.log(`DEBUG: restart in ${WAIT_ON_ERROR_SECONDS} seconds`);

				setTimeout(() => {
					start();
				}, WAIT_ON_ERROR_SECONDS * 1000);
			}
		}

		function runner(lastAuthorityRecordId) {
			return async function next(connection, resultSet, row) {
				if (!row) {
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
					} else if (_.findIndex(list, function (o) {
						return o == row.AUTH_ID;
					}) >= 0) {
						console.log('DEBUG: auth_id  is on list, index: ' + _.findIndex(list, function (o) {
							return o == row.AUTH_ID;
						}));
						await queryForAuthId(connection, row.AUTH_ID);
					} else {
						console.log(`DEBUG: auth_id ${row.AUTH_ID} not on list, skipping!`);
						skipped = true;
					}

					const percentDone = parseInt(row.AUTH_ID) / parseInt(lastAuthorityRecordId) * 100;
					const percentDone2Decimals = Math.floor(percentDone * 100) / 100;

					console.log(`INFO Handling authority record ${row.AUTH_ID} / ${lastAuthorityRecordId} (${percentDone2Decimals}%) (Current time: ${Date().toString()})`);
					const start = process.hrtime();

					const elapsed = estimation.elapsedTime(start, 'FENAU record');
					const recordsToHandle = parseInt(lastAuthorityRecordId) - parseInt(row.AUTH_ID);
					const {timeEstimate, readyEstimate} = estimation.getEstimations(recordsToHandle);

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
						console.log('List handled. Stopping.');
						return;
					}

					const nextRow = await resultSet.getRow();
					next(connection, resultSet, nextRow);
				} catch (error) {
					console.log('SYSTEM-ERROR', error.message, error);

					console.log(`DEBUG: restart in ${WAIT_ON_ERROR_SECONDS} seconds`);
					if (SKIP_ON_ERROR) {
						const failedAuthId = parseInt(row.AUTH_ID);
						console.log(`WARN: Skipping failed record ${failedAuthId}`);
						fs.writeFileSync(atFile, failedAuthId + 1);
					}

					setTimeout(() => {
						start();
					}, WAIT_ON_ERROR_SECONDS * 1000);
				}
			};
		}

		async function queryForAuthId(connection, auth_id) {
			debug('queryForAuthId', auth_id);
			const tasks = await authIdToTasks(connection, auth_id);
			debug(`Number of tasks to handle ${tasks.length}`);

			const [melindaTasks, fenniTasks] = _.partition(tasks, isMelindaTask);

			// Chunk fennitasks to ensure that they are saved only once.
			const fenniGroupedByTypeAndId = chunkWith(fenniTasks, (a, b) => {
				return a.type === b.type && a.type === TASK_TYPES.FENNI_ASTERI && a.bib_id === b.bib_id;
			});

			for (let taskList of fenniGroupedByTypeAndId) {
				taskList = taskList.filter(task => task !== undefined);
				if (taskList.length > 0) {
					await createLinkings(taskList, _.head(taskList).type);
				}
			}

			// Group tasks for same type and id to ensure they are saved only once.
			const groupedByTypeAndId = chunkWith(melindaTasks, (a, b) => {
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

			async function authIdToTasks(connection, auth_id) {
				try {
					const authorityRecord = await voyagerRecordService.readAuthRecord(auth_id);

					if (!RecordUtils.recordIsAgentAuthority(authorityRecord)) {
						console.log(`DEBUG FENAU auth_id ${auth_id} \t Record is not an agent authority. Skipping.`);
						return [];
					}

					const links = RecordUtils.selectMelindaLinks(authorityRecord, '(FI-ASTERI-N)');
					debug('resolveAsteriId', auth_id);
					const asteriId = await resolveAsteriId(undefined, auth_id, ` ${MELINDA_SID_AUT}`, links);

					const queryTermsForFieldSearch = MigrationUtils.selectNameHeadingPermutations(authorityRecord);
					const queryTermsString = queryTermsForFieldSearch.map(sets => sets.map(sub => `‡${sub.code}${sub.value}`));

					const authorityRecordHas100 = authorityRecord.getFields('100').length === 1;
					// Only run fixes for Fennica records
					const fixedAuthorityRecord = authorityRecordHas100 && VOYAGER_DB_NAME === 'fennicadb' ? fixAuthorityRecordYears(authorityRecord) : authorityRecord;

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

					const bibTasks = async () => {
						debug('Resolving tasks for linking fenni - asteri');
						const fenniAsteriTasks = await findFenniAsteriLinkingTasks(connection, auth_id);

						debug('Resolving tasks for linking melinda - asteri', fenniAsteriTasks.length);
						const melindaAsteriTasks = await findMelindaAsteriLinkingTasks(connection, fenniAsteriTasks);

						return {fenniAsteriTasks, melindaAsteriTasks};
					};

					const tasks = await Promise.all([authorityTasks(), bibTasks()]);
					const {fenauAsteriTasks, fenniAsteriTasks, asteriAsteriLinks, melindaAsteriTasks} = tasks.reduce((acc, task) => _.assign(acc, task), {});

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
				} catch (error) {
					if ('stack' in error) {
						debug(error.stack);
					}

					if (isSystemError(error)) {
						throw error;
					}

					if (error && error instanceof ParseError) {
						throw error;
					}

					console.log(`ERROR FENAU auth_id ${auth_id} \t ${error.message}`);

					const authorityRecord = await voyagerRecordService.readAuthRecord(auth_id);

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
					await Promise.all(bibIdGroup.map(async bib_id => {
						debug(`findMelindaAsteriLinkingTasks for ${bib_id}`);
						try {
							const fennicaRecord = await voyagerRecordService.readBibRecord(bib_id);

							const links = RecordUtils.selectMelindaLinks(fennicaRecord);
							const melindaId = await resolveMelindaId(undefined, bib_id, MELINDA_SID_BIB, links);
							const melindaRecord = await alephRecordService.loadRecord(ALEPH_LIBRARY_BIB.toUpperCase(), melindaId);

							melindaAsteriTasks.push({
								type: TASK_TYPES.MELINDA_ASTERI,
								melindaRecord,
								melindaId
							});
						} catch (error) {
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
						const record = await voyagerRecordService.readAuthRecord(linkedAuthorityRecordId);
						if (!RecordUtils.recordIsAgentAuthority(record)) {
							console.log(`DEBUG FENAU auth_id ${linkedAuthorityRecordId} \t Record is not an agent authority. Skipping.`);
							return undefined;
						}

						const links = RecordUtils.selectMelindaLinks(record, '(FI-ASTERI-N)');
						const linkedRecordAsteriId = await resolveAsteriId(undefined, linkedAuthorityRecordId, ` ${MELINDA_SID_AUT}`, links);
						return linkedRecordAsteriId;
					} catch (error) {
						if (isSystemError(error)) {
							throw error;
						}

						console.log(`ERROR FENAU auth_id ${linkedAuthorityRecordId} \t ${error.message}`);
					}
				}));

				const asteriasteriLinks = await Promise.all(_.compact(linkedAsteriIds).map(async linkedAsteriId => {
					const linkedAsteriRecord = await alephRecordService.loadRecord(ALEPH_LIBRARY_AUTH_NAMES.toUpperCase(), linkedAsteriId);

					return {
						type: TASK_TYPES.LINKED_ASTERI_ASTERI,
						linkedAsteriRecord: linkedAsteriRecord,
						linkedAsteriId: linkedAsteriId
					};
				}));

				return asteriasteriLinks;
			}

			async function findFenauAsteriLinkingTasks(connection, auth_id) {
				// Linked authority records
				const linkedAuthorityRecordIds = await queryForLinkedAuthorityRecords(connection, auth_id);

				const linkedFenauLinks = await Promise.all(linkedAuthorityRecordIds.map(async linkedAuthorityRecordId => {
					const linkedAuthorityRecord = await voyagerRecordService.readAuthRecord(linkedAuthorityRecordId);

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
					const bibRecord = await voyagerRecordService.readBibRecord(fenniBibId);

					return {
						type: TASK_TYPES.FENNI_ASTERI,
						bib_id: fenniBibId,
						bibRecord
					};
				})));

				const fuzzyQueryFenniBibIds = await queryFuzzy(connection, auth_id);
				const fuzzyTasksWithoutIndiceTasks = _.difference(fuzzyQueryFenniBibIds, fenniBibIds);

				const fuzzyFenniLinks = await Promise.all(fuzzyTasksWithoutIndiceTasks.map(async bib_id => {
					const bibRecord = await voyagerRecordService.readBibRecord(bib_id);

					return {
						type: TASK_TYPES.FENNI_ASTERI,
						bib_id,
						bibRecord
					};
				}));

				return _.concat(fenniLinks, fuzzyFenniLinks);

				async function serialDropErrors(funcs) {
					const results = await Promise.all(funcs.map(func => {
						try {
							return func();
						} catch (err) {
							console.log('SYSTEM-ERROR', err.message, err);
						}
					}));

					// Remove undefined values
					return results.filter(r => r);
				}
			}
		}

		function isMelindaTask(task) {
			if (task.type === TASK_TYPES.LINKED_ASTERI_ASTERI) {
				return true;
			}

			if (task.type === TASK_TYPES.ASTERI_ASTERI) {
				return true;
			}

			if (task.type === TASK_TYPES.MELINDA_ASTERI) {
				return true;
			}

			return false;
		}
	}

	async function queryForLinkedAuthorityRecords(connection, auth_id) {
		const sql = `
		select distinct (auth_id) from ${VOYAGER_DB_NAME}.auth_heading where (
			heading_id_pointee in
			(select heading_id_pointer from ${VOYAGER_DB_NAME}.auth_heading where auth_id = :auth_id)
			or
			heading_id_pointer in
			(select heading_id_pointee from ${VOYAGER_DB_NAME}.auth_heading where auth_id = :auth_id)
			) and auth_id != :auth_id`;

		const {resultSet} = await connection.execute(sql, [auth_id], {resultSet: true});

		const rows = await readAllRows(resultSet);
		const linkedAuthorityRecordIds = rows.map(row => row.AUTH_ID);

		return linkedAuthorityRecordIds;
	}

	async function queryFromIndices(connection, auth_id) {
		// Find from XXX the bibs that are linked by voyager

		const {resultSet} = await connection.execute(`SELECT HEADING_ID_POINTER, HEADING_ID_POINTEE, REFERENCE_TYPE FROM ${VOYAGER_DB_NAME}.AUTH_HEADING where AUTH_ID = :id and reference_type IN (\'A\', \'N\', \'s\')`, [auth_id], {resultSet: true});
		const rows = await readAllRows(resultSet);

		const headingIds = await getHeadingIds();
		const lookup = await headingIdsToBibIds(connection, headingIds);

		const tasks = headingIds.map(heading_id => {
			const bib_id = lookup[heading_id];
			if (bib_id === undefined) {
				return;
			}

			return bib_id;
		});

		return _.compact(_.flatten(tasks));

		async function getHeadingIds() {
			const idList = _.uniq(_.flatMap(rows, row => {
				return [row.HEADING_ID_POINTER, row.HEADING_ID_POINTEE].filter(item => item !== 0);
			}));

			if (VOYAGER_DB_NAME === 'violadb') {
				const expandedIdList = await Promise.all(idList.map(getIdsByHeading));
				return _.uniq(_.flatten(expandedIdList));
			}

			return idList;

			async function getIdsByHeading(id) {
				const heading = await getHeading();

				console.log(`TEST: ${id}:${heading}`);

				return await getIdsByHeading();

				async function getHeading() {
					const {resultSet} = await connection.execute(`SELECT NORMAL_HEADING FROM ${VOYAGER_DB_NAME}.HEADING where HEADING_ID = :id`, [id], {resultSet: true});
					const {NORMAL_HEADING: heading} = (await readAllRows(resultSet)).shift();
					return heading;
				}

				async function getIdsByHeading() {
					const results = await getRecordsWithHeading();

					console.log(`TEST: Found ${results.length} similar records`);

					return results
						.filter(filterByRelator)
						.map(({HEADING_ID}) => HEADING_ID);

					async function getRecordsWithHeading() {
						const {resultSet} = await connection.execute(`SELECT HEADING_ID, NORMAL_HEADING FROM ${VOYAGER_DB_NAME}.HEADING where NORMAL_HEADING LIKE :heading`, [`${heading}%`], {resultSet: true});
						return readAllRows(resultSet);
					}

					function filterByRelator({NORMAL_HEADING: heading}) {
						return HEADING_RELATOR_STRINGS.some(str => {
							return heading === `${heading} ${str}`;
						});
					}
				}
			}
		}
	}

	async function queryFuzzy(connection, auth_id) {
		const result = await connection.execute(`SELECT * FROM ${VOYAGER_DB_NAME}.AUTH_INDEX where AUTH_ID = :id`, [auth_id], {resultSet: true});
		const rows = await readAllRows(result.resultSet);

		const name = rows.find(row => row.INDEX_CODE === 'A100');
		const birth = rows.find(row => row.INDEX_CODE === 'A46F');
		const death = rows.find(row => row.INDEX_CODE === 'A46G');

		if (name === undefined) {
			return;
		}

		const permuted = [name, birth, death].filter(_.identity).map(row => row.NORMAL_HEADING);

		const perms = permuted.map((item, index) => permuted.slice(0, index + 1));
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

		const sql = `SELECT HEADING_ID, BIB_ID FROM ${VOYAGER_DB_NAME}.BIB_HEADING where HEADING_ID IN (${inClause})`;

		const {resultSet} = await connection.execute(sql, listOfHeadingIds, {resultSet: true});
		const rows = await readAllRows(resultSet);

		const lookup = rows.reduce((acc, obj) => {
			acc[obj.HEADING_ID] = _.chain(acc[obj.HEADING_ID]).concat(obj.BIB_ID).compact().value();
			return acc;
		}, {});

		return lookup;
	}

	async function resolveQuery(connection, queryTerm) {
		const result = await connection.execute(`SELECT * FROM ${VOYAGER_DB_NAME}.HEADING where NORMAL_HEADING = :query`, [queryTerm], {resultSet: true});
		const rows = await readAllRows(result.resultSet);

		const headingIds = rows
			.filter(row => row.INDEX_TYPE === 'N')
			.filter(row => row.HEADING_TYPE === 'p')
			.map(row => row.HEADING_ID);

		const lookup = await headingIdsToBibIds(connection, headingIds);

		return _.flatten(headingIds.map(headingId => lookup[headingId]));
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

	// Utility function for validatng the record-utils normalizer against voyager normalization.
	async function validateNormalizationFunction(connection) {
		const {resultSet} = await connection.execute(`SELECT AUTH_ID, utl_raw.CAST_TO_RAW(NORMAL_HEADING) as NH, utl_raw.CAST_TO_RAW(DISPLAY_HEADING) as DH FROM ${VOYAGER_DB_NAME}.AUTH_INDEX where INDEX_CODE=:id`, ['A100'], {resultSet: true});

		nextFrom(resultSet);

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
	}
}
