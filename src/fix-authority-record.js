
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
import MarcRecord from 'marc-record-js';
import * as recordUtils from './record-utils';
import {Punctuation} from '@natlibfi/melinda-marc-record-utils';

const {AuthRules, PunctuationError, createRecordFixer, RecordTypes} = Punctuation;
const fixPunctuationFromAuthField = createRecordFixer(AuthRules, RecordTypes.AUTHORITY);

const debug = createDebugLogger('melinda-voyager-migrations:fix-authority-record');

export default function (inputRecord) {
	const record = new MarcRecord(inputRecord);

	const field100 = _.head(record.getFields('100'));
	if (field100 === undefined) {
		return record;
	}

	const yearOfBirthFrom046f = recordUtils.selectBirthYear(record);
	const yearOfDeathFrom046g = recordUtils.selectDeathYear(record);

	debug('DEBUG: 046 : ', yearOfBirthFrom046f + ', ' + yearOfDeathFrom046g);

	// Parse birth/death from 100d - note: this loses everything after second hyphen and also non-ASCII-characters
	const [birth, death] = recordUtils.parseYearsFrom100d(record);

	debug('DEBUG: 100d : ', birth + ', ' + death);

	// All defined years must contain only numbers.
	if (!_.compact([yearOfBirthFrom046f, yearOfDeathFrom046g, birth, death]).every(year => /^\d+$/.test(year))) {
		return record;
	}

	if (yearOfBirthFrom046f && birth && yearOfBirthFrom046f !== birth) {
		throw new Error('Record has year of birth in 046f and 100d and they are mismatched');
	}

	if (yearOfDeathFrom046g && death && yearOfDeathFrom046g !== death) {
		throw new Error('Record has year of death in 046g and 100d and they are mismatched');
	}

	const yearOfBirth = yearOfBirthFrom046f || birth;
	const yearOfDeath = yearOfDeathFrom046g || death;

	const updatedFieldDContent = create100d(yearOfBirth, yearOfDeath);

	if (updatedFieldDContent) {
		recordUtils.setSubfield(field100, 'd', updatedFieldDContent, 'j');
		fixPunctuationFromAuthField(field100);
		record.getFields('400').forEach(field400 => {
			recordUtils.setSubfield(field400, 'd', updatedFieldDContent, 'j');
			fixPunctuationFromAuthField(field400);
		});
	}

	return record;

	function create100d(birth, death) {
		if (birth && death) {
			return `${birth}-${death}`;
		}

		if (birth) {
			return `${birth}-`;
		}

		if (death) {
			return `-${death}`;
		}
	}
}
