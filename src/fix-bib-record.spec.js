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
import fixBibRecordField from './fix-bib-record';
import MarcRecord from 'marc-record-js';
import * as recordUtils from './record-utils';

describe('fix bib record', () => {
	let fakeAuthorityRecord;
	let fakeBibRecord;

	beforeEach(() => {
		fakeAuthorityRecord = createFakeAuthorityRecord();
		fakeBibRecord = createFakeBibRecord();
	});

	it('should make a copy of the field', () => {
		const fixed = fixBibRecordField(selectField100(fakeBibRecord), fakeAuthorityRecord);
		expect(fixed).not.to.equal(selectField100(fakeBibRecord));
	});

	it('should do nothing if bibliographic record does not have field 100', () => {
		fakeBibRecord.fields = fakeBibRecord.fields.filter(field => field.tag !== '100');
		const fixed = fixBibRecordField(selectField100(fakeBibRecord), fakeAuthorityRecord);
		expect(fixed).to.eql(selectField100(fakeBibRecord));
	});

	it('should do nothing if authority record does not have field 100', () => {
		fakeAuthorityRecord.fields = fakeAuthorityRecord.fields.filter(field => field.tag !== '100');
		const fixed = fixBibRecordField(selectField100(fakeBibRecord), fakeAuthorityRecord);
		expect(fixed).to.eql(selectField100(fakeBibRecord));
	});

	describe('given authority record with some fields that are missing from the bibliographic record', () => {
		beforeEach(() => {
			recordUtils.setSubfields(fakeAuthorityRecord, '100', [
				{code: 'a', value: 'Aakkula, Immo'},
				{code: 'd', value: '1974-2099'}
			]);
		});

		it('should add the information to the bibliographic record', () => {
			const fixed = fixBibRecordField(selectField100(fakeBibRecord), fakeAuthorityRecord);
			expect(recordUtils.fieldToString(fixed)).to.equal('100 1  ‡aAakkula, Immo‡d1974-2099');
		});

		it('should keep the non-name fields intact in the bibliographic record', () => {
			recordUtils.setSubfields(fakeBibRecord, '100', [
				{code: 'a', value: 'Aakkula, Immo'},
				{code: 'e', value: 'kirjoittaja'}
			]);

			const fixed = fixBibRecordField(selectField100(fakeBibRecord), fakeAuthorityRecord);
			expect(recordUtils.fieldToString(fixed)).to.equal('100 1  ‡aAakkula, Immo‡d1974-2099‡ekirjoittaja');
		});

		it('should set the name portion of the bibliographic record, discarding any non-authorized fields', () => {
			recordUtils.setSubfields(fakeBibRecord, '100', [
				{code: 'a', value: 'Aakkula, Immo'},
				{code: 'b', value: 'kuningas'},
				{code: 'e', value: 'kirjoittaja'}
			]);

			const fixed = fixBibRecordField(selectField100(fakeBibRecord), fakeAuthorityRecord);
			expect(recordUtils.fieldToString(fixed)).to.equal('100 1  ‡aAakkula, Immo‡d1974-2099‡ekirjoittaja');
		});

		it('should keep the fields before name portion', () => {
			recordUtils.setSubfields(fakeBibRecord, '100', [
				{code: '3', value: 'fakelink'},
				{code: 'a', value: 'Aakkula, Immo'},
				{code: 'b', value: 'kuningas'},
				{code: 'e', value: 'kirjoittaja'}
			]);

			const fixed = fixBibRecordField(selectField100(fakeBibRecord), fakeAuthorityRecord);
			expect(recordUtils.fieldToString(fixed)).to.equal('100 1  ‡3fakelink‡aAakkula, Immo‡d1974-2099‡ekirjoittaja');
		});
	});
	describe('given field that is not name field', () => {
		it('should throw an error', () => {
			const fixBibRecordWith245 = fixBibRecordField.bind(null, {tag: '245', subfields: []}, fakeAuthorityRecord);
			expect(fixBibRecordWith245).to.throw;
		});
	});
});

function selectField100(record) {
	return _.head(record.getFields('100'));
}

function createFakeAuthorityRecord() {
	return MarcRecord.fromString(`LDR    00533cz  a2200193n  4500
001    115575
005    20160523161656.0
008    011001|n|az|||aab|           | aaa      
100 1  ‡aAakkula, Immo‡d1974-2099`);
}

function createFakeBibRecord() {
	return MarcRecord.fromString(`LDR    01367cam a2200397 i 4500
001    686292
005    20160322010717.0
008    010815s2001    fi |||||||||||000|||fin| 
100 1  ‡aAakkula, Immo.
245 10 ‡aYmpäristörikokset alueellisten ympäristökeskusten käsittelyssä /‡cImmo Aakkula.
260    ‡aHelsinki :‡bSuomen ympäristökeskus,‡c2001‡f(Edita)
650  7 ‡aympäristörikokset‡2ysa
650  7 ‡aympäristöoikeus‡2ysa`);
}
