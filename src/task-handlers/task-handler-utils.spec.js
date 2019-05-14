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
import {expect} from 'chai';
import MarcRecord from 'marc-record-js';
import * as RecordUtils from '../record-utils';
import * as Utils from './task-handler-utils';

describe('task-handler-utils', () => {
	describe('updateUPDToY', () => {
		let record;
		beforeEach(() => {
			record = createFakeRecord();
		});

		it('should change UPD ‡aN to UPD ‡aY', () => {
			record.appendField(RecordUtils.stringToField('UPD    ‡aN'));
			Utils.updateUPDToY(record);
			const fields = record.fields.map(RecordUtils.fieldToString);
			expect(fields).to.contain('UPD    ‡aY');
			expect(fields).not.to.contain('UPD    ‡aN');
		});
		it('should do nothing if record does not have UPD field', () => {
			const before = MarcRecord.clone(record);
			Utils.updateUPDToY(record);
			expect(before.toString()).to.eql(record.toString());
		});
		it('should do nothing if record has UPD ‡aY', () => {
			record.appendField(RecordUtils.stringToField('UPD    ‡aY'));
			const before = MarcRecord.clone(record);
			Utils.updateUPDToY(record);
			expect(before.toString()).to.eql(record.toString());
		});
		it('should do nothing if record has UPD ‡aX', () => {
			record.appendField(RecordUtils.stringToField('UPD    ‡aX'));
			const before = MarcRecord.clone(record);
			Utils.updateUPDToY(record);
			expect(before.toString()).to.eql(record.toString());
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
