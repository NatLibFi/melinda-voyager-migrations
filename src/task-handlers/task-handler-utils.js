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
import createDebugLogger from 'debug';
import * as RecordUtils from '../record-utils';
import * as MigrationUtils from '../migration-utils';
import * as Utils from '../utils';
import fixBibRecordField from '../fix-bib-record';
import {Punctuation} from '@natlibfi/melinda-marc-record-utils';

const debug = createDebugLogger('melinda-voyager-migrations:task-handler-utils');
const {BibRules, PunctuationError, createRecordFixer} = Punctuation;
const fixPunctuationFromBibField = createRecordFixer(BibRules);

export class TaskError extends Error {
	constructor(message) {
		super();
		Error.captureStackTrace(this, this.constructor);
		this.name = 'TaskError';
		this.message = message;
	}
}

export function readSettings() {
	if (process.env.TEST) {
		return {};
	}

	const XServerUrl = Utils.readEnvironmentVariable('X_SERVER_URL');
	const melindaEndpoint = Utils.readEnvironmentVariable('MELINDA_API_URL');

	const melindaCredentials = {
		username: Utils.readEnvironmentVariable('MELINDA_USERNAME'),
		password: Utils.readEnvironmentVariable('MELINDA_PASSWORD')
	};

	const voyagerApiUrl = Utils.readEnvironmentVariable('VOYAGER_API_URL');
	const voyagerApiKey = Utils.readEnvironmentVariable('VOYAGER_API_KEY');

	const dryRun = Utils.readEnvironmentVariable('NOOP', false) != false;

	return {XServerUrl, melindaEndpoint, melindaCredentials, voyagerApiUrl, voyagerApiKey, dryRun};
}

export function hasLink(field, expectedLinkValue) {
	// ExpectedLinkValue (FIN11) -> FI-ASTERI-N
	const alternateFormat = expectedLinkValue.startsWith('(FIN11)') ? '(FI-ASTERI-N)' + expectedLinkValue.substr(7) : null;

	const subfields = _.get(field, 'subfields', []);
	if (subfields.length > 0) {
		const subfield0 = subfields.filter(subfield => subfield.code === '0');

		if (subfield0.length === 0) {
			return false;
		}

		return subfield0.some(subfield => subfield.value === expectedLinkValue || subfield.value === alternateFormat);
	}

	return false;
}

export function hasInvalidLink(field, expectedLinkValue, linkPrefix, linkValue) {
	// ExpectedLinkValue (FIN11) -> FI-ASTERI-N
	const alternateFormat = expectedLinkValue.startsWith('(FIN11)') ? '(FI-ASTERI-N)' + expectedLinkValue.substr(7) : null;

	const alternateFormatPrefix = linkPrefix === '(FIN11)' ? '(FI-ASTERI-N)' : null;

	const subfields = _.get(field, 'subfields', []);

	let hasInvalidLink = false;

	if (subfields.length > 0) {
		const subfield0 = subfields.filter(subfield => subfield.code === '0' && ((subfield.value.startsWith(linkPrefix) || (alternateFormatPrefix && (subfield.value.startsWith(alternateFormatPrefix))))));

		if (subfield0.length === 0) {
			return false;
		}

		return subfield0.some(subfield => subfield.value !== expectedLinkValue && subfield.value !== alternateFormat);

		/*
		HasInvalidLink =  subfield0.forEach( function(subfield) {
		debug("Checking: ", subfield.value);
		if ((subfield.value.startsWith(linkPrefix) || (alternateFormatPrefix && (subfield.value.startsWith(alternateFormatPrefix)))))  {
				debug("Found prefixes: ", subfield.value);

				if (subfield.value !== expectedLinkValue && subfield.value !== alternateFormat) {
			debug("Link is invalid asteri-link: ", subfield.value);
			return true;
		 }
		 else {
		 debug("Link is valid asteri-link: ", subfield.value);
		 }
			 }
			 else {
		 debug("Link is non-asteri-link: ", subfield.value);
			 }

			});

	}

	debug("DEBUG: END", hasInvalidLink);
	return hasInvalidLink;
*/
	}

	return false;
}

export function validateLink(field, expectedLinkValue) {
	// ExpectedLinkValue (FIN11) -> FI-ASTERI-N
	const alternateFormat = expectedLinkValue.startsWith('(FIN11)') ? '(FI-ASTERI-N)' + expectedLinkValue.substr(7) : null;
	// Debug("DEBUG: Searching field", field);
	// debug("DEBUG: for linkValues:", expectedLinkValue+" "+alternateFormat);

	const subfields = _.get(field, 'subfields', []);

	if (subfields.length > 0) {
		return subfields.filter(subfield => subfield.code === '0').every(subfield => subfield.value === expectedLinkValue || subfield.value === alternateFormat);
	}

	return true;
}

export function logFieldDiff(a, b) {
	const changedRecordFields = a.fields.map(RecordUtils.fieldToString);
	const originalRecordFields = b.fields.map(RecordUtils.fieldToString);
	const fieldsToRemove = _.difference(originalRecordFields, changedRecordFields);
	const fieldsToAdd = _.difference(changedRecordFields, originalRecordFields);

	if (fieldsToRemove.length > 0 || fieldsToAdd.length > 0) {
		debug('DEBUG These fields', fieldsToRemove);
		debug('DEBUG are replaced by', fieldsToAdd);
	}
}

export function errorLogger(params) {
	const {record1Type, record1, record2Type, record2, linkSourceRecordId, linkTargetRecordId, queryTermsString, db, dbType} = params;
	return function (error) {
		const logRecords = () => {
			console.log(`${record1Type}:`);
			console.log(record1.toString());
			console.log(`${record2Type}:`);
			console.log(record2.toString());
		};

		if (error instanceof PunctuationError) {
			console.log(`ERROR ${db} ${dbType} ${linkSourceRecordId} \t ${error.name}: ${error.message}`);
			return;
		}

		if (error instanceof MigrationUtils.LinkingQueryError) {
			if (error.message === 'Found only 8XX field for linking.') {
				console.log(`WARN: Found only 8XX field from ${db} record ${linkSourceRecordId} to add the link to authority record ${linkTargetRecordId}. Query terms: ${queryTermsString}`);
				return;
			}

			console.log(`ERROR: Could not find field from ${db} record ${linkSourceRecordId} to add the link to authority record ${linkTargetRecordId}. Query terms: ${queryTermsString}`);
			logRecords();
			return;
		}

		console.log('ERROR: Unhandled error');
		console.log(error);
		logRecords();
	};
}

export function fixBibField(db, linkPrefix, asteriId, fixedAuthorityRecord, bib_id, field) {
	const link = `${linkPrefix}${asteriId}`;

	// TODO: before fixing bib record field we have to ensure that we will not overwrite any current d subfields. Throw error if target contains d subfield with differing content.
	const fixedField = fixBibRecordField(field, fixedAuthorityRecord);
	fixPunctuationFromBibField(fixedField);

	if (!validateLink(fixedField, link)) {
		if (db != 'MELINDA') {
			throw new TaskError(`Record ${db} bib_id ${bib_id} already has 0 link (${RecordUtils.fieldToString(fixedField)}) that is different from the one being added ${link}.`);
		} else {
			if (hasInvalidLink(fixedField, link, linkPrefix, asteriId)) {
			// Debug("hasInvalidLink returned true");
				throw new TaskError(`Record ${db} bib_id ${bib_id} already has 0 link (${RecordUtils.fieldToString(fixedField)}) that is different from the one being added ${link}.`);
			}

			console.log(`WARN: Record ${db} bib_id ${bib_id} already has 0 link (${RecordUtils.fieldToString(fixedField)}) that is different from the one being added ${link}.`);
		}
	}

	if (_.isEqual(field, fixedField)) {
		if (!hasLink(fixedField, link)) {
			const currentContent1 = RecordUtils.fieldToString(fixedField);
			console.log(`INFO ${db} bib_id ${bib_id} \t Adds $0 link without other changes (before adding):  ${currentContent1}`);

			// RecordUtils.setSubfield(fixedField, '0', link, '9');
			RecordUtils.addSubfield(fixedField, '0', link, '9');

			const changedContent = RecordUtils.fieldToString(fixedField);
			console.log(`INFO ${db} bib_id ${bib_id} \t Adds $0 link without other changes:  ${changedContent}`);
		} else {
			debug('DEBUG: Has link already :', RecordUtils.fieldToString(fixedField));
		}
	} else {
		const currentContent = RecordUtils.fieldToString(field);
		const changedContent = RecordUtils.fieldToString(fixedField);

		if (!hasLink(fixedField, link)) {
			RecordUtils.addSubfield(fixedField, '0', link, '9');
		} else {
			debug('DEBUG: Has link already :', RecordUtils.fieldToString(fixedField));
		}

		const changedContentWithLink = RecordUtils.fieldToString(fixedField);

		// Console.log(`INFO: I would link authority record ${auth_id} to bibliographic record ${bib_id} with $0 subfield in field ${field.tag} containing ${link}`);

		console.log(`WARN ${db} bib_id ${bib_id} \t Changes content in the field ${fixedField.tag}`);
		console.log(`WARN ${db} bib_id ${bib_id} \t Currently the content is: ${currentContent}`);
		console.log(`WARN ${db} bib_id ${bib_id} \t After update it becomes:  ${changedContent}`);
		console.log(`WARN ${db} bib_id ${bib_id} \t Adds $0 link:             ${changedContentWithLink}`);
	}

	return fixedField;
}

export function recordsEqual(recordA, recordB) {
	return recordA.toString() === recordB.toString();
}

export function updateUPDToY(record) {
//  Console.log(`INFO Updating UPD field`);
	record.fields
		.filter(field => field.tag === 'UPD')
		.forEach(field => {
			field.subfields
				.filter(subfield => subfield.code === 'a' && subfield.value === 'N')
				.forEach(subfield => {
					subfield.value = 'Y';
				});
		});
}
