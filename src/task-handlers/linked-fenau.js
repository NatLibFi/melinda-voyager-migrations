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
import MarcRecord from 'marc-record-js';
import {AuthorizedPortion} from '@natlibfi/melinda-marc-record-utils';
import * as RecordUtils from '../record-utils';
import * as MigrationUtils from '../migration-utils';
import * as taskUtils from './task-handler-utils';
import createVoyagerRecordService from '../voyager-record-service';

const {voyagerApiKey, voyagerApiUrl, dryRun} = taskUtils.readSettings();
const voyagerRecordService = createVoyagerRecordService({url: voyagerApiUrl, apiKey: voyagerApiKey});

export default (fixPunctuationFromAuthField, tasks) => {
	const task = _.head(tasks);
	const {fenauRecordId, linkedFenauRecord, linkedFenauRecordId, fixedAuthorityRecord, queryTermsString} = task;

	if (MigrationUtils.isIndexTermRecord(linkedFenauRecord)) {
		console.log(`WARN FENAU auth_id ${linkedFenauRecordId} \t Linked record ${linkedFenauRecordId} is an index term record. Skipping.`);
		return Promise.resolve();
	}

	try {
		const fixedRecord = transformRecord(fixPunctuationFromAuthField, task);
		taskUtils.logFieldDiff(fixedRecord, linkedFenauRecord);

		if (taskUtils.recordsEqual(fixedRecord, linkedFenauRecord)) {
			console.log(`INFO FENAU auth_id ${linkedFenauRecordId} \t No changes.`);
			return;
		}

		console.log(`INFO FENAU auth_id ${linkedFenauRecordId} \t Saving record to fenau`);
		if (dryRun) {
			console.log(`INFO FENAU auth_id ${linkedFenauRecordId} \t Dry run - not saving`);
			return;
		}

		return voyagerRecordService.saveAuthRecord(linkedFenauRecordId, fixedRecord).then(res => {
			console.log(`INFO FENAU auth_id ${linkedFenauRecordId} \t Record saved successfully`);
			return res;
		});
	} catch (error) {
		taskUtils.errorLogger({
			record1Type: 'LINKED-AUTH',
			record1: linkedFenauRecord,
			record2Type: 'AUTH',
			record2: fixedAuthorityRecord,
			linkSourceRecordId: linkedFenauRecordId,
			linkTargetRecordId: fenauRecordId,
			queryTermsString,
			db: 'FENAU',
			dbType: 'auth_id'
		})(error);
	}

	function transformRecord(fixPunctuationFromAuthField, task) {
		const {fenauRecordId, asteriIdForLinking, linkedFenauRecord, linkedFenauRecordId, queryTermsForFieldSearch, fixedAuthorityRecord} = task;

		const fixedRecord = MarcRecord.clone(linkedFenauRecord);

		const fields = MigrationUtils.selectFieldFromAuthorityRecordForLinkingWithZero(linkedFenauRecord, queryTermsForFieldSearch);

		fixedRecord.fields = linkedFenauRecord.fields.map(field => {
			if (!_.includes(fields, field)) {
				return field;
			}

			const link = `(FI-ASTERI-N)${asteriIdForLinking}`;

			const fixedField = _.cloneDeep(field);
			if (!taskUtils.validateLink(fixedField, link)) {
				throw new taskUtils.TaskError(`Record ${fenauRecordId} already has 0 link (${RecordUtils.fieldToString(fixedField)}) that is different from the one being added ${link}.`);
			}

			if (field.tag === '100') {
				const fennicaAutorityRecordNamePortion = findAuthorizedPortion(RecordType.AUTH, fixedField);
				updateAuthorizedPortion(RecordType.AUTH, fixedField, fennicaAutorityRecordNamePortion);
				fixPunctuationFromAuthField(fixedField);
			}

			if (_.isEqual(field, fixedField)) {
				if (!taskUtils.hasLink(fixedField, link)) {
					RecordUtils.setSubfield(fixedField, '0', link, '9');
					const changedContent = RecordUtils.fieldToString(fixedField);
					console.log(`INFO FENAU auth_id ${linkedFenauRecordId} \t Adds $0 link without other changes:  ${changedContent}`);
				}
			} else {
				const currentContent = RecordUtils.fieldToString(field);
				const changedContent = RecordUtils.fieldToString(fixedField);

				RecordUtils.setSubfield(fixedField, '0', link, '9');
				const changedContentWithLink = RecordUtils.fieldToString(fixedField);

				console.log(`WARN FENAU auth_id ${linkedFenauRecordId} \t Changes content in the field ${fixedField.tag}`);
				console.log(`WARN FENAU auth_id ${linkedFenauRecordId} \t Currently the content is: ${currentContent}`);
				console.log(`WARN FENAU auth_id ${linkedFenauRecordId} \t After update it becomes:  ${changedContent}`);
				console.log(`WARN FENAU auth_id ${linkedFenauRecordId} \t Adds $0 link:             ${changedContentWithLink}`);
			}

			return fixedField;
		});

		return RecordUtils.mergeDuplicateFields(fixedRecord);
	}
};
