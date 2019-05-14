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
import * as utils from './utils';
import createDebugLogger from 'debug';

const debug = createDebugLogger('melinda-voyager-migrations:record-utils');

export const RecordType = {
	AUTH: 'AUTH',
	BIB: 'BIB'
};

export function mergeDuplicateFields(record) {
	const copy = new MarcRecord(record);

	copy.fields = utils.chunkWith(copy.fields, isDuplicateFields).map(mergeFields);

	return copy;

	function isDuplicateFields(a, b) {
		const omitControlSubfields = _.partial(omitSubfields, ['5', '9']);
		if (a.tag === 'CAT') {
			return false;
		}

		return _.isEqual(
			omitControlSubfields(a),
			omitControlSubfields(b)
		);

		function omitSubfields(codes, field) {
			if (field && field.subfields) {
				return _.assign({}, field, {
					subfields: field.subfields.filter(sub => !_.includes(codes, sub.code))
				});
			}

			return _.assign({}, field);
		}
	}

	// [item] -> item
	function mergeFields(fields) {
		return fields.reduce((mergedField, field) => {
			return _.mergeWith(mergedField, field, customizer);
		});

		function customizer(objValue, srcValue) {
			if (_.isArray(objValue)) {
				const diff = _.differenceWith(srcValue, objValue, _.isEqual);
				return _.concat(objValue, diff);
			}
		}
	}
}

export function fieldToString(field) {
	if (field && field.subfields) {
		const ind1 = field.ind1 || ' ';
		const ind2 = field.ind2 || ' ';
		const subfields = field.subfields.map(subfield => `‡${subfield.code}${subfield.value}`).join('');
		return `${field.tag} ${ind1}${ind2} ${subfields}`;
	}

	return `${field.tag}    ${field.value}`;
}

export function stringToField(fieldStr) {
	const tag = fieldStr.substr(0, 3);
	const ind1 = fieldStr.substr(4, 1);
	const ind2 = fieldStr.substr(5, 1);
	const subfieldsStr = fieldStr.substr(6);

	const subfields = _.tail(subfieldsStr.split('‡')).map(subfieldStr => ({
		code: subfieldStr.substr(0, 1),
		value: subfieldStr.substr(1)
	}));

	return {tag, ind1, ind2, subfields};
}

export function setSubfields(record, tag, subfields) {
	record.getFields(tag).forEach(field => {
		field.subfields = subfields;
	});
}

export function parseYearsFrom100d(record) {
	const f100d = selectFirstSubfieldValue(record, '100', 'd');
	const [birth, death] = f100d ? f100d.split('-') : [];

	const normalize = str => str && str.split('').filter(c => /[0-9]|\w|\s/.test(c)).join('');

	return [normalize(birth) || undefined, normalize(death) || undefined];
}

export function subfieldOrderNumber(subfieldCode) {
	if (_.includes(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'], subfieldCode)) {
		return subfieldCode.charCodeAt(0) + 200;
	}

	return subfieldCode.charCodeAt(0);
}

export function setSubfield(field, code, value, beforeCode) {
	const location = _.findIndex(field.subfields, sub => sub.code === code);

	if (location !== -1) {
		field.subfields.splice(location, 1, {code, value});
	} else {
		const appendLocation = _.findIndex(field.subfields, sub => subfieldOrderNumber(sub.code) >= subfieldOrderNumber(beforeCode));
		const index = appendLocation !== -1 ? appendLocation : field.subfields.length;

		field.subfields.splice(index, 0, {code, value});
	}
}

export function selectBirthYear(record) {
	return selectFirstSubfieldValue(record, '046', 'f');
}

export function selectDeathYear(record) {
	return selectFirstSubfieldValue(record, '046', 'g');
}

export function selectFirstSubfieldValue(record, tag, code) {
	const subfields = _.flatMap(record.getFields(tag), field => field.subfields);
	const subfieldValues = subfields
		.filter(subfield => subfield.code === code)
		.map(subfield => subfield.value);

	return _.head(subfieldValues);
}

export function addSubfield(field, code, value, beforeCode) {
	const location = _.findIndex(field.subfields, sub => sub.code === code);
	debug('Found existing subfield in location: ', location);

	if (location !== -1) {
		field.subfields.splice(location, 0, {code, value});
	} else {
		const appendLocation = _.findIndex(field.subfields, sub => subfieldOrderNumber(sub.code) >= subfieldOrderNumber(beforeCode));
		const index = appendLocation !== -1 ? appendLocation : field.subfields.length;

		field.subfields.splice(index, 0, {code, value});
	}
}

// Nimiosuus: $a, $b, $c, $d, $g (jos ennen $t:tä), $j, $q

// Links should be selected from 035a. the content must start with FCC.
export function selectMelindaLinks(record, linkPrefix = 'FCC') {
	return _.flatMap(record.getFields('035').map(field => field.subfields))
		.filter(subfield => subfield.code === 'a')
		.filter(subfield => _.startsWith(subfield.value, linkPrefix))
		.map(subfield => subfield.value.substr(linkPrefix.length));
}

// Linked here means linked inside the record, like cyrillic information
export function isLinkedField(field) {
	return field.subfields.some(subfield => subfield.code === '6');
}

export function recordIsAgentAuthority(authorityRecord) {
	const agentAuthorityFields = authorityRecord.fields.filter(field => _.includes(['100', '110', '111'], field.tag));
	if (agentAuthorityFields.length === 0) {
		return false;
	}

	return agentAuthorityFields
		.every(field => {
			const subfieldCodes = field.subfields.map(subfield => subfield.code);
			return !_.includes(subfieldCodes, 't');
		});
}

