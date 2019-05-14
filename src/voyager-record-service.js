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

import fetch from 'node-fetch';
import HttpStatus from 'http-status';
import {MARCXML} from 'marc-record-serializers';

export default ({url, apiKey}) => {
	return {
		readAuthRecord,
		readBibRecord,
		saveAuthRecord,
		saveBibRecord
	};

	async function readAuthRecord(id) {
		return readRecord({id, resource: 'auth'});
	}

	async function readBibRecord(id) {
		return readRecord({id, resource: 'bib'});
	}

	async function saveAuthRecord(id, record) {
		return saveRecord({id, record, resource: 'auth'});
	}

	async function saveBibRecord(id, record) {
		return saveRecord({id, record, resource: 'bib'});
	}

	async function readRecord({id, resource}) {
		const response = await fetch(`${url}?resource=${resource}&apiKey=${apiKey}&id=${id}`, {
			headers: {
				Accept: 'application/xml'
			}
		});

		if (response.status === HttpStatus.OK) {
			return MARCXML.fromMARCXML(await response.text());
		}

		throw new Error(`${response.status}: ${await response.text()}`);
	}

	async function saveRecord({id, record, resource}) {
		return await fetch(`${url}?resource=${resource}&apiKey=${apiKey}&id=${id}&update=1`, {
			method: 'POST',
			body: MARCXML.toMARCXML(record),
			headers: {
				'Content-Type': 'application/xml'
			}
		});
	}
};

