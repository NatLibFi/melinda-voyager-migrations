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
**/

import _ from 'lodash';
import crypto from 'crypto';
import createDebugLogger from 'debug';

const debug = createDebugLogger('melinda-voyager-migrations:utils');

export function readEnvironmentVariable(name, defaultValue, opts) {
	if (process.env[name] === undefined) {
		if (defaultValue === undefined) {
			const message = `Mandatory environment variable missing: ${name}`;
			console.log('error', message);
			throw new Error(message);
		}

		const loggedDefaultValue = _.get(opts, 'hideDefaultValue') ? '[hidden]' : defaultValue;
		console.log('info', `No environment variable set for ${name}, using default value: ${loggedDefaultValue}`);
	}

	return _.get(process.env, name, defaultValue);
}

export function readArrayEnvironmentVariable(name, defaultValue, opts) {
	const value = readEnvironmentVariable(name, defaultValue, opts);
	return value === defaultValue ? value : value.split('|');
}

export function serial(funcs) {
	return funcs.reduce((promise, func) => {
		return promise.then(all => func().then(result => _.concat(all, result)));
	}, Promise.resolve([]));
}

export function decorateConnectionWithDebug(connection) {
	const actualExecute = connection.execute;
	connection.execute = function () {
		console.log('DEBUG-SQL', `'${arguments[0]}'`, arguments[1]);
		return actualExecute.apply(this, arguments);
	};
}

export function elapsedTime(start) {
	const [s, nano] = process.hrtime(start);
	const total = s + nano / 1000000000;
	const elapsed = Math.round(total * 100) / 100;
	return elapsed;
}

export async function readAllRows(resultSet, rows = []) {
	const nextRow = await resultSet.getRow();

	if (!nextRow) {
		await resultSet.close();
		return rows;
	}

	rows.push(nextRow);
	return readAllRows(resultSet, rows);
}

// [item] -> [[item]]
export function chunkWith(arr, similarityPredicate) {
	let mutableArray = _.clone(arr);

	const result = [];

	do {
		const item = mutableArray.shift();
		const similarItems = mutableArray.filter(_.partial(similarityPredicate, item));
		result.push(_.concat(item, similarItems));

		mutableArray = _.without(mutableArray, ...similarItems);
	} while (mutableArray.length > 0);

	return result;
}

export function RecentChangesManager(recentChangeCooldownMs = 20000) {
	const recentChanges = {};
	function checkAndUpdateRecentChanges(library, recordId, patch, now = Date.now()) {
		purgeOldChanges(now);

		const changeHash = createChangeHash(library, recordId, patch);

		const isRecentChange = _.get(recentChanges, changeHash);
		const wasChangedDuringCooldown = now - _.get(isRecentChange, 'at', 0) < recentChangeCooldownMs;
		if (isRecentChange && wasChangedDuringCooldown) {
			return true;
		}

		_.set(recentChanges, changeHash, {at: now});
		return false;
	}

	function deepDiff(collectionA, collectionB) {
		const identicalFields = _.intersectionWith(collectionA, collectionB, _.isEqual);
		const a = collectionA.filter(field => !_.find(identicalFields, _.curry(_.isEqual)(field)));
		const b = collectionB.filter(field => !_.find(identicalFields, _.curry(_.isEqual)(field)));
		return {a, b};
	}

	function createChangeHash(library, recordId, patch) {
		const hash = crypto.createHash('sha256');
		hash.update(library + recordId + JSON.stringify(patch));
		return hash.digest('hex');
	}

	function purgeOldChanges(now) {
		Object.keys(recentChanges).forEach(changeHash => {
			const changeDate = _.get(recentChanges, [changeHash, 'at']);
			if (now - changeDate > recentChangeCooldownMs) {
				debug(`Purging old change from ${changeDate}`);
				delete (recentChanges[changeDate]);
			}
		});
	}

	return {
		checkAndUpdateRecentChanges
	};
}

export function accumulate(count, fn, fnContext) {
	let callCount = 0;
	const accumulator = function () {
		callCount++;
		if (callCount === count) {
			fn.call(fnContext || null);
			callCount = 0;
		}
	};

	accumulator.reset = () => callCount = 0;
	return accumulator;
}

export function parseTime(time) {
	const [hour, minute] = time.split(':').map(numStr => parseInt(numStr));
	return hour * 60 + minute;
}

export function getCurrentTime() {
	const time = new Date();
	return `${time.getHours()}:${time.getMinutes()}`;
}

export function parseTimeRanges(timeRanges) {
	return timeRanges.split(',').map(rangeStr => {
		const [from, to] = rangeStr.trim().split('-');

		return {
			from: parseTime(from),
			to: parseTime(to)
		};
	});
}

export function randomString() {
	return Math.floor(Math.random() * 1E12).toString(16);
}
