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

import {expect} from 'chai';
import MarcRecord from 'marc-record-js';
import _ from 'lodash';
import * as MigrationUtils from './migration-utils';
import fixBibRecordField from './fix-bib-record';
import * as RecordUtils from './record-utils';

describe('MigrationUtils', () => {
	describe('migrateCSubfield', () => {
		const tests = [
			[
				'should keep v and drop c if bib has both ‡c(fiktiivinen hahmo) and ‡vfiktio.',
				'100 14 ‡aLardot, Raisa',
				'600 14 ‡aLardot, Raisa‡c(fiktiivinen hahmo)‡vfiktio.',
				'600 14 ‡aLardot, Raisa‡vfiktio.'
			], [
				'should create new ‡vfiktio. and drop c if bib has only ‡c(fiktiivinen hahmo)',
				'100 14 ‡aLardot, Raisa',
				'600 14 ‡aLardot, Raisa‡c(fiktiivinen hahmo)',
				'600 14 ‡aLardot, Raisa‡vfiktio.'
			], [
				'should keep v and drop c if bib has both',
				'100 14 ‡aLardot, Raisa',
				'600 14 ‡aLardot, Raisa‡c(fiktiv gestalt)‡vfiktion.',
				'600 14 ‡aLardot, Raisa‡vfiktion.'
			], [
				'should create new ‡vfiktion. and drop c if bib has only ‡c(fiktiv gestalt)',
				'100 14 ‡aLardot, Raisa',
				'600 14 ‡aLardot, Raisa‡c(fiktiv gestalt)',
				'600 14 ‡aLardot, Raisa‡vfiktion.'
			], [
				'should not create a new ‡v if auth and bib have ‡c',
				'100 14 ‡aRinta-Puhkuri, Tyyne‡c(fiktiivinen hahmo)',
				'600 14 ‡aRinta-Puhkuri, Tyyne‡c(fiktiivinen hahmo)',
				'600 14 ‡aRinta-Puhkuri, Tyyne‡c(fiktiivinen hahmo)'
			], [
				'should keep non-authorized fields when applying migration',
				'100 14 ‡aRinta-Puhkuri, Tyyne‡c(fiktiivinen hahmo)',
				'700 14 ‡aRinta-Puhkuri, Tyyne‡c(fiktiivinen hahmo)‡etoimittaja.',
				'700 14 ‡aRinta-Puhkuri, Tyyne‡c(fiktiivinen hahmo)‡etoimittaja.'
			], [
				'should keep v from bib and c from auth',
				'100 14 ‡aRinta-Puhkuri, Tyyne‡c(fiktiivinen hahmo)',
				'600 14 ‡aRinta-Puhkuri, Tyyne‡vfiktio.',
				'600 14 ‡aRinta-Puhkuri, Tyyne‡c(fiktiivinen hahmo)‡vfiktio.'
			], [
				'should not create a new ‡v if auth has c with something else than (fiktiivinen hahmo) or (fiktiv gestalt)',
				'100 14 ‡aRinta-Puhkuri, Tyyne‡cjotain-muuta',
				'600 14 ‡aRinta-Puhkuri, Tyyne‡vfiktio.',
				'600 14 ‡aRinta-Puhkuri, Tyyne‡cjotain-muuta‡vfiktio.'
			], [
				'should not create anything if bib has c with something else than (fiktiivinen hahmo) or (fiktiv gestalt)',
				'100 14 ‡aLardot, Raisa',
				'600 14 ‡aLardot, Raisa,‡cjotain muuta',
				'600 14 ‡aLardot, Raisa'
			]
		];

		tests.forEach(test => {
			const [testName, authorityRecordFieldStr, bibRecordFieldStr, expectedFieldStr] = test;
			it(testName, () => {
				const authorityRecordField = RecordUtils.stringToField(authorityRecordFieldStr);
				const authorityRecord = new MarcRecord({fields: [authorityRecordField]});
				const bibRecordField = RecordUtils.stringToField(bibRecordFieldStr);

				const resultingField = fixBibRecordField(bibRecordField, authorityRecord);
				expect(RecordUtils.fieldToString(resultingField)).to.equal(expectedFieldStr);
			});
		});
	});

	describe('selectFieldFromAuthorityRecordForLinkingWithZero', () => {
		it('should return an array of fields that match the query terms, and no longer terms', () => {
			const fakeRecord = createFakeRecord();

			fakeRecord.appendField(RecordUtils.stringToField('510 2  ‡aTampereen yliopisto.‡bHallintotieteiden laitos'));
			fakeRecord.appendField(RecordUtils.stringToField('510 2  ‡aTampereen yliopisto.‡bHallintotieteiden laitos.‡bAluetiede'));

			const fakeQueryTerms = [
				[{code: 'a', value: 'TAMPEREEN YLIOPISTO'}, {code: 'b', value: 'HALLINTOTIETEIDEN LAITOS'}]
			];

			const fields = MigrationUtils.selectFieldFromAuthorityRecordForLinkingWithZero(fakeRecord, fakeQueryTerms);

			expect(fields).to.be.instanceof(Array);
			expect(fields).to.have.lengthOf(1);
		});

		it('should return an array of fields that match the query terms, and no shorter terms', () => {
			const fakeRecord = createFakeRecord();

			fakeRecord.appendField(RecordUtils.stringToField('510 2  ‡aTampereen yliopisto.‡bHallintotieteiden laitos'));
			fakeRecord.appendField(RecordUtils.stringToField('510 2  ‡aTampereen yliopisto.‡bHallintotieteiden laitos.‡bAluetiede'));

			const fakeQueryTerms = [
				[{code: 'a', value: 'TAMPEREEN YLIOPISTO'}, {code: 'b', value: 'HALLINTOTIETEIDEN LAITOS'}, {code: 'b', value: 'ALUETIEDE'}]
			];

			const fields = MigrationUtils.selectFieldFromAuthorityRecordForLinkingWithZero(fakeRecord, fakeQueryTerms);

			expect(fields).to.be.instanceof(Array);
			expect(fields).to.have.lengthOf(1);
		});
	});

	describe('selectFieldForLinkingWithZero', () => {
		it('should return an array of fields that match the query terms', () => {
			const fakeRecord = createFakeRecord();

			fakeRecord.appendField(RecordUtils.stringToField('100    ‡aAakkula, Immo,‡tcontent'));
			fakeRecord.appendField(RecordUtils.stringToField('700    ‡aAakkula, Immo'));

			const fakeQueryTerms = [
				[{code: 'a', value: 'AAKKULA IMMO'}]
			];

			const fields = MigrationUtils.selectFieldForLinkingWithZero(fakeRecord, fakeQueryTerms);

			expect(fields).to.be.instanceof(Array);
			expect(fields).to.have.lengthOf(2);
		});

		it('should match the years from d subfield', () => {
			const fakeRecord = createFakeRecord();

			fakeRecord.appendField(RecordUtils.stringToField('100    ‡aAakkula, Immo,‡d1992-2017'));
			fakeRecord.appendField(RecordUtils.stringToField('700    ‡aAakkula, Immo'));

			const fakeQueryTerms = [
				[{code: 'a', value: 'AAKKULA IMMO'}, {code: 'd', value: '1992 2017'}]
			];

			const fields = MigrationUtils.selectFieldForLinkingWithZero(fakeRecord, fakeQueryTerms);

			expect(fields).to.an.instanceOf(Array);
			expect(fields).to.have.lengthOf(1);

			expect(RecordUtils.fieldToString(_.head(fields))).to.equal('100    ‡aAakkula, Immo,‡d1992-2017');
		});

		it('should not use any years in d subfield with values enclosed in parenthesis for matching', () => {
			const fakeRecord = createFakeRecord();

			fakeRecord.appendField(RecordUtils.stringToField('100    ‡aAakkula, Immo,‡d(12)'));

			const fakeQueryTerms = [
				[{code: 'a', value: 'AAKKULA IMMO'}]
			];

			const fields = MigrationUtils.selectFieldForLinkingWithZero(fakeRecord, fakeQueryTerms);

			expect(fields).to.an.instanceOf(Array);
			expect(fields).to.have.lengthOf(1);
			expect(RecordUtils.fieldToString(_.head(fields))).to.equal('100    ‡aAakkula, Immo,‡d(12)');
		});

		it('should not use any c subfield with content (fiktiivinen hahmo) or (fiktiv gestalt)', () => {
			const fakeRecord = createFakeRecord();

			fakeRecord.appendField(RecordUtils.stringToField('600  4 ‡aAakkula, Immo,‡c(fiktiivinen hahmo)'));
			fakeRecord.appendField(RecordUtils.stringToField('600  4 ‡aAakkula, Immo,‡c(fiktiv gestalt)'));

			const fakeQueryTerms = [
				[{code: 'a', value: 'AAKKULA IMMO'}]
			];

			const fields = MigrationUtils.selectFieldForLinkingWithZero(fakeRecord, fakeQueryTerms);

			expect(fields).to.an.instanceOf(Array);
			expect(fields).to.have.lengthOf(2);

			expect(RecordUtils.fieldToString(fields[0])).to.equal('600  4 ‡aAakkula, Immo,‡c(fiktiivinen hahmo)');
			expect(RecordUtils.fieldToString(fields[1])).to.equal('600  4 ‡aAakkula, Immo,‡c(fiktiv gestalt)');
		});
	});

	describe('selectNameHeadingPermutations', () => {
		it('should create array of name-heading permutations from record', () => {
			const fakeRecord = createFakeRecord();

			fakeRecord.appendField(RecordUtils.stringToField('100    ‡aAakkula, Immo,‡tcontent'));
			expect(MigrationUtils.selectNameHeadingPermutations(fakeRecord)).to.be.instanceOf(Array);
		});

		it('should pick authorized fields for the name-heading permutations', () => {
			const fakeRecord = createFakeRecord();

			fakeRecord.appendField(RecordUtils.stringToField('100    ‡aAakkula, Immo,‡c(Immis)‡qboink‡tcontent'));
			expect(MigrationUtils.selectNameHeadingPermutations(fakeRecord)).to.be.eql([
				[
					{code: 'a', value: 'AAKKULA IMMO'},
					{code: 'q', value: 'BOINK'},
					{code: 'c', value: 'IMMIS'}
				]
			]);
		});

		it('should generate permutations for the d subfield (dates of birth and death)', () => {
			const fakeRecord = createFakeRecord();

			fakeRecord.appendField(RecordUtils.stringToField('046    ‡f1992‡g2017'));
			fakeRecord.appendField(RecordUtils.stringToField('100    ‡aAakkula, Immo,‡tcontent'));
			expect(MigrationUtils.selectNameHeadingPermutations(fakeRecord)).to.be.eql([
				[{code: 'a', value: 'AAKKULA IMMO'}],
				[{code: 'a', value: 'AAKKULA IMMO'}, {code: 'd', value: '1992'}],
				[{code: 'a', value: 'AAKKULA IMMO'}, {code: 'd', value: '1992 2017'}]
			]);
		});

		it('should generate permutations for the d subfield (dates of birth and death) if 100d already contains a permutation', () => {
			const fakeRecord = createFakeRecord();

			fakeRecord.appendField(RecordUtils.stringToField('046    ‡f1992‡g2017'));
			fakeRecord.appendField(RecordUtils.stringToField('100    ‡aAakkula, Immo,‡d1992-‡tcontent'));
			expect(MigrationUtils.selectNameHeadingPermutations(fakeRecord)).to.be.eql([
				[{code: 'a', value: 'AAKKULA IMMO'}],
				[{code: 'a', value: 'AAKKULA IMMO'}, {code: 'd', value: '1992'}],
				[{code: 'a', value: 'AAKKULA IMMO'}, {code: 'd', value: '1992 2017'}]
			]);
		});

		it('should throw an error if 100d is not any of the generated permutations', () => {
			const fakeRecord = createFakeRecord();

			fakeRecord.appendField(RecordUtils.stringToField('046    ‡f1900‡g2000'));
			fakeRecord.appendField(RecordUtils.stringToField('100    ‡aAakkula, Immo,‡d2099‡tcontent'));

			MigrationUtils.selectNameHeadingPermutations(fakeRecord);
		});

		it('should not throw an error if there is no 046 to generate permutations', () => {
			const fakeRecord = createFakeRecord();

			fakeRecord.appendField(RecordUtils.stringToField('100    ‡aAakkula, Immo,‡dkuollut 2000‡tcontent'));
			MigrationUtils.selectNameHeadingPermutations(fakeRecord);

			/*			Expect(() => {
				MigrationUtils.selectNameHeadingPermutations(fakeRecord);
			}).not.to.throw('Record contains 100d with content that cannot be reconstructed from 046'); */
		});

		it('should not throw an error if there is non-numeric 100d', () => {
			const fakeRecord = createFakeRecord();

			fakeRecord.appendField(RecordUtils.stringToField('046    ‡f1900‡g2000'));
			fakeRecord.appendField(RecordUtils.stringToField('100    ‡aAakkula, Immo,‡dkuollut 2000‡tcontent'));

			MigrationUtils.selectNameHeadingPermutations(fakeRecord);
			// Expect(MigrationUtils.selectNameHeadingPermutations.bind(null, fakeRecord)).not.to.throw('Record contains 100d with content that cannot be reconstructed from 046');
		});

		it('should not generate permutations for the d subfield (dates of birth and death) if 100d already contains something different', () => {
			const fakeRecord = createFakeRecord();

			fakeRecord.appendField(RecordUtils.stringToField('100    ‡aAakkula, Immo,‡dkuollut 2000‡tcontent'));
			expect(MigrationUtils.selectNameHeadingPermutations(fakeRecord)).to.be.eql([
				[{code: 'a', value: 'AAKKULA IMMO'}, {code: 'd', value: 'KUOLLUT 2000'}]
			]);
		});
	});
});

function createFakeRecord() {
	return MarcRecord.fromString(`LDR    00533cz  a2200193n  4500
001    115575
005    20160523161656.0
008    011001|n|az|||aab|           | aaa      `);
}
