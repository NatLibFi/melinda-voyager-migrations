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
import fetch from 'node-fetch';
import RecordSerializers from 'marc-record-serializers';
import querystring from 'querystring';
import createDebugLogger from 'debug';
import {promisify} from 'util';
import {parseString} from 'xml2js';

const parseXML = promisify(parseString);
const debug = createDebugLogger('melinda-voyager-migrations:aleph-record-service');

const ResponseMessageTypes = {
	WARNING: 'WARNING',
	TRIGGER: 'TRIGGER',
	MANDATORY: 'MANDATORY'
};

export class AlephRecordError extends Error {
	constructor(message, code) {
		super();
		Error.captureStackTrace(this, this.constructor);
		this.name = 'AlephRecordError';
		this.message = message;
		this.code = code;
	}
}

export default (XServer, credentials) => {
	function loadRecord(base, recordId) {
		const requestUrl = `${XServer}?op=find-doc&doc_num=${recordId}&base=${base}&show_sub6=Y`;

		return fetch(requestUrl)
			.then(response => response.text())
			.then(parseXMLRecordResponse);
	}

	function createRecord(base, record) {
		return saveRecord(base, '000000000', record);
	}

	function saveRecord(base, recordId, record) {
		if (!credentials) {
			throw new Error('Credentials are required for saving records');
		}

		const recordInOAI_MARCXML = RecordSerializers.OAI_MARCXML.toOAI_MARCXML(record);

		var declaration = '<?xml version = "1.0" encoding = "UTF-8"?>\n';

		const requestParams = querystring.stringify({
			user_name: credentials.username,
			user_password: credentials.password,
			op: 'update_doc',
			doc_num: recordId,
			library: base,
			doc_action: 'UPDATE',
			xml_full_req: `${declaration}<record>${recordInOAI_MARCXML}</record>`
		});

		debug(`Saving record ${base} / ${recordId}`);
		return fetch(XServer, {method: 'POST', body: requestParams})
			.then(response => {
				if (response.status !== 200) {
					throw new AlephRecordError(`Updated failed. RecordId: ${recordId}. Statuscode: ${response.status}`);
				}

				return response;
			})
			.then(response => response.text())
			.then(parseXML)
			.then(response => parseUpdateResponse(recordId, response));
	}

	function parseUpdateResponse(recordId, updateResponse) {
		const rawMessages = _.get(updateResponse, 'update-doc.error', []);
		const sessionId = _.get(updateResponse, 'update-doc.session-id', []);

		const successMessagePattern = new RegExp('.*Document: (\\d+) was updated successfully.');
		const successMessage = rawMessages.find(message => successMessagePattern.test(message));

		if (successMessage) {
			const [, recordId] = successMessagePattern.exec(successMessage);
			const messages = _.without(rawMessages, successMessage).map(parseMessage);
			debug(`record ${recordId} was updated successfully.`);
			return {recordId, messages, sessionId};
		}

		// Failed.
		const loginError = _.get(updateResponse, 'login.error', []);
		if (loginError.length) {
			throw new AlephRecordError(_.head(loginError));
		}

		const errorMessages = rawMessages.map(parseMessage);

		const failureMessages = errorMessages.filter(message => message.type === ResponseMessageTypes.MANDATORY);

		if (failureMessages.length > 0) {
			const {code, message} = _.head(failureMessages);
			throw new AlephRecordError(message, code);
		} else {
			if (errorMessages.length > 0) {
				const {code, message} = _.head(errorMessages);
				if (message === undefined || message === '') {
					throw new AlephRecordError(`Update failed due to unkown reason. RecordId: ${recordId} Response was: ` + JSON.stringify(updateResponse));
				}

				throw new AlephRecordError(`${message} RecordId: ${recordId} Response was: ` + JSON.stringify(updateResponse), code);
			}

			throw new AlephRecordError(`Update failed due to unkown reason. RecordId: ${recordId} Response was: ` + JSON.stringify(updateResponse));
		}
	}

	function parseMessage(message) {
		const messagePattern = new RegExp('^\\[(\\d+)\\] (.*?)(- (?:mandatory|warning|trigger) error)?$');

		const match = messagePattern.exec(message);

		if (match) {
			const [, code, message, type] = match;
			return {code, message, type: formatMessageType(type)};
		}

		throw new Error(`Unable to parse message: ${message}`);
	}

	function formatMessageType(rawType) {
		switch (rawType) {
			case '- trigger error': return ResponseMessageTypes.TRIGGER;
			case '- warning error': return ResponseMessageTypes.WARNING;
			case '- mandatory error': return ResponseMessageTypes.MANDATORY;
		}
	}

	function parseXMLRecordResponse(XServerXMLResponse) {
		return RecordSerializers.OAI_MARCXML.fromOAI_MARCXML(XServerXMLResponse);
	}

	return {
		loadRecord,
		saveRecord,
		createRecord
	};
};
