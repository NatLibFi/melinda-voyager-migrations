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

import MelindaClient from 'melinda-api-client';
import RecordSerializers from 'marc-record-serializers';
import createAlephRecordService, {AlephRecordError} from './aleph-record-service';

export {AlephRecordError};

export default (melindaEndpoint, XServer, credentials) => {
	const client = new MelindaClient({
		endpoint: melindaEndpoint,
		user: credentials.username,
		password: credentials.password
	});

	const alephRecordServiceX = createAlephRecordService(XServer, credentials);

	function loadRecord(base, recordId) {
		return alephRecordServiceX.loadRecord(base, recordId);
	}

	function createRecord(base, record) {
		if (base.toLowerCase() === 'fin01') {
			return new Promise((resolve, reject) => client.createRecord(record).then(resolve).catch(reject).done());
		}

		return saveRecord(base, '000000000', record);
	}

	function saveRecord(base, recordId, record) {
		if (base.toLowerCase() === 'fin01' && isOversized(record)) {
			return new Promise((resolve, reject) => client.updateRecord(record).then(resolve).catch(reject).done());
		}

		return alephRecordServiceX.saveRecord(base, recordId, record);
	}

	function isOversized(record) {
		const recordInOAI_MARCXML = RecordSerializers.OAI_MARCXML.toOAI_MARCXML(record);
		const declaration = '<?xml version = "1.0" encoding = "UTF-8"?>\n';
		const xml_full_req = `${declaration}<record>${recordInOAI_MARCXML}</record>`;
		return Buffer.from(xml_full_req).length > 20000;
	}

	return {
		loadRecord,
		saveRecord,
		createRecord
	};
};
