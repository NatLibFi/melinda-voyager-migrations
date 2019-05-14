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
import * as MigrationUtils from './migration-utils';

export default (inputBibRecordField, authRecord) => {
	if (inputBibRecordField === undefined || _.head(authRecord.getFields('100')) === undefined) {
		return inputBibRecordField;
	}

	let bibRecordField = _.cloneDeep(inputBibRecordField);

	const authorizedPortion = MigrationUtils.selectAuthorizedPortion(authRecord);

	bibRecordField = MigrationUtils.migrateCSubfield(authorizedPortion, bibRecordField);

	MigrationUtils.setAuthorizedPortion(bibRecordField, authorizedPortion);

	return bibRecordField;
};
