/**
* Copyright 2017, 2019 University Of Helsinki (The National Library Of Finland)
*
* Licensed under the Apache License, Version 2.0 (the "License";
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
import HttpStatus from 'http-status';
import {expect} from 'chai';
import MarcRecord from 'marc-record-js';
import * as RecordUtils from '../record-utils';
import handleFenauRecord, {__RewireAPI__ as RewireAPI} from './fenau'; // eslint-disable-line import/named
import {TASK_TYPES} from '../constants';
// Import nock from 'nock';

describe('fenau', () => {
	before(() => {
		process.env.NOOP = '1';
		process.env.X_SERVER_URL = 'https://x';
		process.env.MELINDA_API_URL = 'https://melinda';
		process.env.MELINDA_USERNAME = 'foo';
		process.env.MELINDA_PASSWORD = 'bar';
		process.env.VOYAGER_API_URL = 'https://vger';
		process.env.VOYAGER_API_KEY = 'foobar';
	});

	after(() => {
		delete process.env.NOOP;
		delete process.env.ALEPH_X_SERVER_URL;
		delete process.env.MELINDA_API_URL;
		delete process.env.MELINDA_USERNAME;
		delete process.env.MELINDA_PASSWORD;
		delete process.env.VOYAGER_API_URL;
		delete process.env.VOYAGER_API_KEY;
	});

	describe('handleFenauRecord', () => {
		describe('while fennica record did not need fixing for years', () => {
			it('should throw error if adding link that is different from the current link', async () => {
				const fenauRecord = createFakeRecord();
				const fixedAuthorityRecord = fenauRecord;
				const asteriIdForLinking = '000000123';
				const fenauRecordId = '22';
				const queryTermsForFieldSearch = [
					[{code: 'a', value: 'AAKKULA IMMO'}]
				];

				fixedAuthorityRecord.fields = fenauRecord.fields.filter(field => field.tag !== '100');
				fixedAuthorityRecord.appendField(RecordUtils.stringToField('100    ‡aAakkula, Immo‡0(FI-ASTERI-N)444444'));

				const result = await handleFenauRecord([{
					asteriIdForLinking, fenauRecord, fenauRecordId,
					queryTermsForFieldSearch, fixedAuthorityRecord,
					type: TASK_TYPES.FENAU_ASTERI,
					queryTermsString: ''
				}]);

				expect(result).to.be.an.instanceof(Error);
				expect(result.message).to.equal('Record 22 already has 0 link (100    ‡aAakkula, Immo‡0(FI-ASTERI-N)444444) that is different from the one being added (FI-ASTERI-N)000000123.');
			});
		});

		describe('while fennica record was fixed', () => {
			it('should work', async () => {
				const fenauRecord = createFakeRecord();
				const fixedAuthorityRecord = createFakeRecord();
				const asteriIdForLinking = '000000123';
				const fenauRecordId = '22';
				const queryTermsForFieldSearch = [
					[{code: 'a', value: 'AAKKULA IMMO'}]
				];

				/* nock('https://vger')
					.post('/?resource=aut&apiKey=foobar&id=22').reply(HttpStatus.NO_CONTENT);
*/
				const result = await handleFenauRecord([{
					asteriIdForLinking, fenauRecord, fenauRecordId,
					queryTermsForFieldSearch, fixedAuthorityRecord,
					type: TASK_TYPES.FENAU_ASTERI,
					queryTermsString: ''
				}]);

				expect(result).to.be.undefined;
			});

			it('should throw error if adding link that is different from the current link', async () => {
				const fenauRecord = createFakeRecord();
				const fixedAuthorityRecord = createFakeRecord();
				const asteriIdForLinking = '000000123';
				const fenauRecordId = '22';
				const queryTermsForFieldSearch = [
					[{code: 'a', value: 'AAKKULA IMMO'}]
				];

				fixedAuthorityRecord.fields = fenauRecord.fields.filter(field => field.tag !== '100');
				fixedAuthorityRecord.appendField(RecordUtils.stringToField('100    ‡aAakkula, Immo‡0(FI-ASTERI-N)444444'));

				const result = await handleFenauRecord([{
					asteriIdForLinking, fenauRecord, fenauRecordId,
					queryTermsForFieldSearch, fixedAuthorityRecord,
					type: TASK_TYPES.FENAU_ASTERI,
					queryTermsString: ''
				}]);

				expect(result).to.instanceOf(Error);
				expect(result.message).to.equal('Record 22 already has 0 link (100    ‡aAakkula, Immo‡0(FI-ASTERI-N)444444) that is different from the one being added (FI-ASTERI-N)000000123.');
			});
		});
	});
});

function createFakeRecord() {
	return MarcRecord.fromString(`LDR    00533cz  a2200193n  4500
001    115575
005    20160523161656.0
008    011001|n|az|||aab|           | aaa      
100 1  ‡aAakkula, Immo`);
}
