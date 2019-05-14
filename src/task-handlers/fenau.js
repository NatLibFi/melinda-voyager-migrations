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
import MarcRecord from 'marc-record-js';
import * as RecordUtils from '../record-utils';
import * as MigrationUtils from '../migration-utils';
import * as taskUtils from './task-handler-utils';
import createVoyagerRecordService from '../voyager-record-service';

export default async tasks => {
	const {voyagerApiKey, voyagerApiUrl, dryRun} = taskUtils.readSettings();
	const voyagerRecordService = createVoyagerRecordService({url: voyagerApiUrl, apiKey: voyagerApiKey});

	const task = _.head(tasks);
	// FixedAuthorityRecord is the fenauRecord with it's years updated.
	const {asteriIdForLinking, fenauRecord, fenauRecordId, queryTermsForFieldSearch, queryTermsString, fixedAuthorityRecord} = task;
	const link = `(FI-ASTERI-N)${asteriIdForLinking}`;

	try {
		const fixedRecord = (fixedAuthorityRecord !== fenauRecord) ?
			transformRecord(fenauRecord, fixedAuthorityRecord, link, fenauRecordId) :
			insertLinks(fenauRecord, link, queryTermsForFieldSearch, fenauRecordId);

		taskUtils.logFieldDiff(fixedRecord, fenauRecord);

		if (taskUtils.recordsEqual(fixedRecord, fenauRecord)) {
			console.log(`INFO FENAU auth_id ${fenauRecordId} \t No changes.`);
			return;
		}

		console.log(`INFO FENAU auth_id ${fenauRecordId} \t Saving record to fenau`);
		if (dryRun) {
			console.log(`INFO FENAU auth_id ${fenauRecordId} \t Dry run - not saving`);
			return;
		}

		return voyagerRecordService.saveAuthRecord(fenauRecordId, fixedRecord).then(res => {
			if (res.status < 200 || res.status >= 300) {
				throw new taskUtils.TaskError(`FENAU auth_id ${fenauRecordId} saving failed \t ${res.status} ${res.statusText}`);
			}

			console.log(`INFO FENAU auth_id ${fenauRecordId} \t Record saved successfully ${res.status} ${res.statusText}`);
			return res;
		});
	} catch (error) {
		if (error instanceof taskUtils.TaskError) {
			console.log(`ERROR: ${error.message}`);
		} else {
			console.log(error);
			console.log(`ERROR: Could not find field from authority record ${fenauRecordId} to add the link to authority record ${fenauRecordId}. Query terms: ${queryTermsString}`);
			console.log(`AUTH: ${fenauRecord.toString()}`);
		}

		return error;
	}

	function transformRecord(fenauRecord, fixedAuthorityRecord, link, fenauRecordId) {
		const originalAuthority100 = _.head(fenauRecord.getFields('100'));
		const fixedField = _.head(fixedAuthorityRecord.getFields('100'));

		if (!taskUtils.validateLink(fixedField, link)) {
			throw new taskUtils.TaskError(`Record ${fenauRecordId} already has 0 link (${RecordUtils.fieldToString(fixedField)}) that is different from the one being added ${link}.`);
		}

		if (!_.isEqual(originalAuthority100, fixedField)) {
			const currentAuthorityRecordContent = RecordUtils.fieldToString(originalAuthority100);
			const fixedAuthorityRecordContent = RecordUtils.fieldToString(fixedField);

			console.log(`WARN FENAU auth_id ${fenauRecordId} \t Currently the content is: ${currentAuthorityRecordContent}`);
			console.log(`WARN FENAU auth_id ${fenauRecordId} \t After update it becomes:  ${fixedAuthorityRecordContent}`);
		}

		if (!taskUtils.hasLink(fixedField, link)) {
			RecordUtils.setSubfield(fixedField, '0', link, '9');
			const fixedAuthorityRecordContent = RecordUtils.fieldToString(fixedField);
			console.log(`INFO FENAU auth_id ${fenauRecordId} \t Adds $0 link without other changes:  ${fixedAuthorityRecordContent}`);
		}

		return RecordUtils.mergeDuplicateFields(fixedAuthorityRecord);
	}

	function insertLinks(fenauRecord, link, queryTermsForFieldSearch, fenauRecordId) {
		const fixedRecord = MarcRecord.clone(fenauRecord);
		const fields = MigrationUtils.selectFieldForLinkingWithZero(fenauRecord, queryTermsForFieldSearch);

		fixedRecord.fields = fenauRecord.fields.map(field => {
			if (!_.includes(fields, field)) {
				return field;
			}

			const fixedField = _.cloneDeep(field);

			if (!taskUtils.validateLink(fixedField, link)) {
				throw new taskUtils.TaskError(`Record ${fenauRecordId} already has 0 link (${RecordUtils.fieldToString(fixedField)}) that is different from the one being added ${link}.`);
			}

			if (!taskUtils.hasLink(fixedField, link)) {
				RecordUtils.setSubfield(fixedField, '0', link, '9');
				const changedContent = RecordUtils.fieldToString(fixedField);
				console.log(`INFO FENAU auth_id ${fenauRecordId} \t Adds $0 link without other changes:  ${changedContent}`);
			}

			return fixedField;
		});

		return RecordUtils.mergeDuplicateFields(fixedRecord);
	}
};
