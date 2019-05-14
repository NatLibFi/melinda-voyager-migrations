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
 *//* eslint no-console: 0 */

import {Punctuation} from '@natlibfi/melinda-marc-record-utils';
import handleFenauRecord from './task-handlers/fenau';
import handleLinkedFenauRecord from './task-handlers/linked-fenau';
import handleLinkedAsteriRecord from './task-handlers/linked-asteri';
import handleAsteriRecordFix from './task-handlers/asteri';
import handleMelindaRecord from './task-handlers/melinda';
import handleFenniRecord from './task-handlers/fenni';

import {TASK_TYPES} from './constants';

export default (alephRecordService, voyagerRecordService) => {
	const {AuthRules, createRecordFixer, RecordTypes} = Punctuation;
	const fixPunctuationFromAuthField = createRecordFixer(AuthRules, RecordTypes.AUTHORITY);

	return (tasks, taskType) => {
		if (taskType === TASK_TYPES.FENAU_ASTERI) {
			return handleFenauRecord(tasks);
		}

		if (taskType === TASK_TYPES.LINKED_FENAU_ASTERI) {
			return handleLinkedFenauRecord(fixPunctuationFromAuthField, tasks);
		}

		if (taskType === TASK_TYPES.FENNI_ASTERI) {
			return handleFenniRecord(tasks);
		}

		if (taskType === TASK_TYPES.LINKED_ASTERI_ASTERI) {
			return handleLinkedAsteriRecord(fixPunctuationFromAuthField, tasks);
		}

		if (taskType === TASK_TYPES.ASTERI_ASTERI) {
			return handleAsteriRecordFix(fixPunctuationFromAuthField, tasks);
		}

		if (taskType === TASK_TYPES.MELINDA_ASTERI) {
			return handleMelindaRecord(tasks);
		}

		throw new Error(`Unable to find handler for task ${taskType}`);
	};
};
