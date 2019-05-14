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
import fixAuthorityRecordYears from './fix-authority-record';
import MarcRecord from 'marc-record-js';
import * as recordUtils from './record-utils';

describe('fix authority record', () => {
	let fakeRecord;

	beforeEach(() => {
		fakeRecord = createFakeRecord();
	});

	it('should return a record', () => {
		const fixed = fixAuthorityRecordYears(fakeRecord);
		expect(fixed).to.be.instanceof(MarcRecord);
	});

	it('should make a copy of the record', () => {
		const fixed = fixAuthorityRecordYears(fakeRecord);
		expect(fixed).not.to.equal(fakeRecord);
	});

	it('should do nothing if record does not have field 100', () => {
		fakeRecord.fields = fakeRecord.fields.filter(field => field.tag !== '100');
		const fixed = fixAuthorityRecordYears(fakeRecord);
		expect(fixed).not.to.equal(fakeRecord);
	});

	describe('given record with year of birth', () => {
		beforeEach(() => {
			fakeRecord.insertField(['046', '', '', 'f', '1974']);
		});

		it('should create 100d with the year', () => {
			const fixed = fixAuthorityRecordYears(fakeRecord);
			const fixed100 = recordUtils.fieldToString(_.head(fixed.getFields('100')));
			expect(fixed100).to.equal('100 1  ‡aAakkula, Immo,‡d1974-');
		});

		it('should not duplicate it if it already exists in the record', () => {
			recordUtils.setSubfields(fakeRecord, '100', [{code: 'a', value: 'Aakkula, Immo'}, {code: 'd', value: '1974-'}]);

			const fixed = fixAuthorityRecordYears(fakeRecord);
			const fixed100 = recordUtils.fieldToString(_.head(fixed.getFields('100')));
			expect(fixed100).to.equal('100 1  ‡aAakkula, Immo,‡d1974-');
		});

		it('should add the birth year if there is only year of death', () => {
			recordUtils.setSubfields(fakeRecord, '100', [{code: 'a', value: 'Aakkula, Immo'}, {code: 'd', value: '-2099'}]);

			const fixed = fixAuthorityRecordYears(fakeRecord);
			const fixed100 = recordUtils.fieldToString(_.head(fixed.getFields('100')));
			expect(fixed100).to.equal('100 1  ‡aAakkula, Immo,‡d1974-2099.');
		});
	});

	describe('given record with year of death', () => {
		beforeEach(() => {
			fakeRecord.insertField(['046', '', '', 'g', '2099']);
		});

		it('should create 100d with the year', () => {
			const fixed = fixAuthorityRecordYears(fakeRecord);
			const fixed100 = recordUtils.fieldToString(_.head(fixed.getFields('100')));
			expect(fixed100).to.equal('100 1  ‡aAakkula, Immo,‡d-2099.');
		});
		it('should not duplicate it if it already exists in the record', () => {
			recordUtils.setSubfields(fakeRecord, '100', [{code: 'a', value: 'Aakkula, Immo'}, {code: 'd', value: '-2099'}]);

			const fixed = fixAuthorityRecordYears(fakeRecord);
			const fixed100 = recordUtils.fieldToString(_.head(fixed.getFields('100')));
			expect(fixed100).to.equal('100 1  ‡aAakkula, Immo,‡d-2099.');
		});
		it('should add the death year if there is only year of birth', () => {
			recordUtils.setSubfields(fakeRecord, '100', [{code: 'a', value: 'Aakkula, Immo'}, {code: 'd', value: '1974-'}]);

			const fixed = fixAuthorityRecordYears(fakeRecord);
			const fixed100 = recordUtils.fieldToString(_.head(fixed.getFields('100')));
			expect(fixed100).to.equal('100 1  ‡aAakkula, Immo,‡d1974-2099.');
		});

		it('should not update birth/death dates that include non-numbers', () => {
			recordUtils.setSubfields(fakeRecord, '100', [{code: 'a', value: 'Hamnius, Carl,'}, {code: 'd', value: 'kuollut 1696'}]);
			recordUtils.setSubfields(fakeRecord, '046', [{code: 'g', value: '1696'}]);

			const fixed = fixAuthorityRecordYears(fakeRecord);
			const fixed100 = recordUtils.fieldToString(_.head(fixed.getFields('100')));

			expect(fixed100).to.equal('100 1  ‡aHamnius, Carl,‡dkuollut 1696');
		});
	});

	describe('given record with more subfields in title', () => {
		beforeEach(() => {
			fakeRecord.insertField(['046', '', '', 'g', '2099']);
		});

		it('should add the d to the end of the field, if j subfield is missing', () => {
			recordUtils.setSubfields(fakeRecord, '100', [{code: 'a', value: 'Aakkula, Immo'}, {code: 'b', value: 'fakecontent'}]);

			const fixed = fixAuthorityRecordYears(fakeRecord);
			const fixed100 = recordUtils.fieldToString(_.head(fixed.getFields('100')));
			expect(fixed100).to.equal('100 1  ‡aAakkula, Immo‡bfakecontent,‡d-2099.');
		});

		it('should add the d subfield before j subfield', () => {
			recordUtils.setSubfields(fakeRecord, '100', [
				{code: 'a', value: 'Aakkula, Immo'},
				{code: 'b', value: 'fakecontent'},
				{code: 'j', value: 'fakerelation'}
			]);

			const fixed = fixAuthorityRecordYears(fakeRecord);
			const fixed100 = recordUtils.fieldToString(_.head(fixed.getFields('100')));
			expect(fixed100).to.equal('100 1  ‡aAakkula, Immo‡bfakecontent,‡d-2099,‡jfakerelation.');
		});
	});

	describe('given record with year of birth and death', () => {
		beforeEach(() => {
			fakeRecord.insertField(['046', '', '', 'f', '1974']);
			fakeRecord.insertField(['046', '', '', 'g', '2099']);
		});

		it('should create 100d with the year', () => {
			const fixed = fixAuthorityRecordYears(fakeRecord);
			const fixed100 = recordUtils.fieldToString(_.head(fixed.getFields('100')));
			expect(fixed100).to.equal('100 1  ‡aAakkula, Immo,‡d1974-2099.');
		});

		it('should not duplicate year of death it if it already exists in the record', () => {
			recordUtils.setSubfields(fakeRecord, '100', [{code: 'a', value: 'Aakkula, Immo'}, {code: 'd', value: '-2099'}]);

			const fixed = fixAuthorityRecordYears(fakeRecord);
			const fixed100 = recordUtils.fieldToString(_.head(fixed.getFields('100')));
			expect(fixed100).to.equal('100 1  ‡aAakkula, Immo,‡d1974-2099.');
		});
		it('should not duplicate year of birth it if it already exists in the record', () => {
			recordUtils.setSubfields(fakeRecord, '100', [{code: 'a', value: 'Aakkula, Immo'}, {code: 'd', value: '1974-'}]);

			const fixed = fixAuthorityRecordYears(fakeRecord);
			const fixed100 = recordUtils.fieldToString(_.head(fixed.getFields('100')));
			expect(fixed100).to.equal('100 1  ‡aAakkula, Immo,‡d1974-2099.');
		});

		it('should do nothing if everyting is ok already', () => {
			recordUtils.setSubfields(fakeRecord, '100', [{code: 'a', value: 'Aakkula, Immo'}, {code: 'd', value: '1974-2099'}]);

			const fixed = fixAuthorityRecordYears(fakeRecord);
			const fixed100 = recordUtils.fieldToString(_.head(fixed.getFields('100')));
			expect(fixed100).to.equal('100 1  ‡aAakkula, Immo,‡d1974-2099.');
		});

		it('should also create 400d with the year', () => {
			fakeRecord.insertField(['400', '1', '', 'a', 'Immo Aakkula']);
			const fixed = fixAuthorityRecordYears(fakeRecord);
			const fixed100 = recordUtils.fieldToString(_.head(fixed.getFields('100')));
			const fixed400 = recordUtils.fieldToString(_.head(fixed.getFields('400')));
			expect(fixed100).to.equal('100 1  ‡aAakkula, Immo,‡d1974-2099.');
			expect(fixed400).to.equal('400 1  ‡aImmo Aakkula,‡d1974-2099.');
		});

		it('should ignore punctuation', () => {
			recordUtils.setSubfields(fakeRecord, '100', [{code: 'a', value: 'Aakkula, Immo'}, {code: 'd', value: '1974-2099,'}, {code: 'e', value: 'Tyyppi'}]);

			const fixed = fixAuthorityRecordYears(fakeRecord);
			const fixed100 = recordUtils.fieldToString(_.head(fixed.getFields('100')));
			expect(fixed100).to.equal('100 1  ‡aAakkula, Immo,‡d1974-2099,‡eTyyppi.');
		});
	});

	describe('given record with mismatcing information', () => {
		it('should throw an error', () => {
			fakeRecord.insertField(['046', '', '', 'f', '1974']);
			fakeRecord.insertField(['046', '', '', 'g', '2099']);
			recordUtils.setSubfields(fakeRecord, '100', [{code: 'a', value: 'Aakkula, Immo'}, {code: 'd', value: '1973-2099'}]);

			expect(fixAuthorityRecordYears.bind(null, fakeRecord)).to.throw();
		});
	});

	describe('given record without birth or death years', () => {
		it('should not do anything', () => {
			const fixed = fixAuthorityRecordYears(fakeRecord);
			expect(fixed.toString()).to.eql(fakeRecord.toString());
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
