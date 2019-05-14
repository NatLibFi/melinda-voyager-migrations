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
import {AuthorizedPortion} from '@natlibfi/melinda-marc-record-utils';
import * as RecordUtils from '../record-utils';
import * as MigrationUtils from '../migration-utils';
import * as taskUtils from './task-handler-utils';
import createMelindaRecordService from '../melinda-record-service';

const {findAuthorizedPortion, updateAuthorizedPortion, RecordType} = AuthorizedPortion;
const {XServerUrl, melindaEndpoint, melindaCredentials, dryRun} = taskUtils.readSettings();
const melindaRecordService = createMelindaRecordService(melindaEndpoint, XServerUrl, melindaCredentials);

export default (fixPunctuationFromAuthField, tasks) => {
	const task = _.head(tasks);
	const {fixedAuthorityRecord, linkedAsteriRecord, linkedAsteriId, asteriIdForLinking, queryTermsForFieldSearch, queryTermsString} = task;

	if (MigrationUtils.isIndexTermRecord(linkedAsteriRecord)) {
		console.log(`WARN ASTERI auth_id ${linkedAsteriId} \t Linked record ${linkedAsteriId} is an index term record. Skipping.`);
		return Promise.resolve();
	}

	try {
		const fixedRecord = MarcRecord.clone(linkedAsteriRecord);

		//*    TaskUtils.updateUPDToY(fixedRecord);

		const fields = MigrationUtils.selectFieldFromAuthorityRecordForLinkingWithZero(linkedAsteriRecord, queryTermsForFieldSearch);

		fixedRecord.fields = linkedAsteriRecord.fields.map(field => {
			if (!_.includes(fields, field)) {
				return field;
			}

			const link = `(FIN11)${asteriIdForLinking}`;

			const fixedField = _.cloneDeep(field);
			if (!taskUtils.validateLink(fixedField, link)) {
				throw new taskUtils.TaskError(`Record ${linkedAsteriId} already has 0 link (${RecordUtils.fieldToString(fixedField)}) that is different from the one being added ${link}.`);
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
					console.log(`INFO ASTERI auth_id ${linkedAsteriId} \t Adds $0 link without other changes:  ${changedContent}`);
				}
			} else {
				const currentContent = RecordUtils.fieldToString(field);
				const changedContent = RecordUtils.fieldToString(fixedField);

				RecordUtils.setSubfield(fixedField, '0', link, '9');
				const changedContentWithLink = RecordUtils.fieldToString(fixedField);

				console.log(`WARN ASTERI auth_id ${linkedAsteriId} \t Changes content in the field ${fixedField.tag}`);
				console.log(`WARN ASTERI auth_id ${linkedAsteriId} \t Currently the content is: ${currentContent}`);
				console.log(`WARN ASTERI auth_id ${linkedAsteriId} \t After update it becomes:  ${changedContent}`);
				console.log(`WARN ASTERI auth_id ${linkedAsteriId} \t Adds $0 link:             ${changedContentWithLink}`);
			}

			return fixedField;
		});

		const compactedRecord = RecordUtils.mergeDuplicateFields(fixedRecord);
		taskUtils.logFieldDiff(compactedRecord, linkedAsteriRecord);

		taskUtils.updateUPDToY(compactedRecord);

		if (taskUtils.recordsEqual(compactedRecord, linkedAsteriRecord)) {
			console.log(`INFO ASTERI auth_id ${linkedAsteriId} \t No changes.`);
			return;
		}

		if (dryRun) {
			console.log(`INFO ASTERI auth_id ${linkedAsteriId} \t Dry run - not saving`);
			return;
		}

		console.log(`INFO ASTERI auth_id ${linkedAsteriId} \t Saving record to asteri`);

		return melindaRecordService.saveRecord('fin11', linkedAsteriId, compactedRecord).then(res => {
			console.log(`INFO ASTERI auth_id ${linkedAsteriId} \t Record saved successfully`);
			return res;
		});
	} catch (error) {
		taskUtils.errorLogger({
			record1Type: 'LINKED-ASTERI',
			record1: linkedAsteriRecord,
			record2Type: 'ASTERI-AUTH',
			record2: fixedAuthorityRecord,
			linkSourceRecordId: linkedAsteriId,
			linkTargetRecordId: asteriIdForLinking,
			queryTermsString,
			db: 'ASTERI',
			dbType: 'auth_id'
		})(error);
	}
};
