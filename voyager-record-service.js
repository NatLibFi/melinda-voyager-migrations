/**
 * Copyright 2017 University Of Helsinki (The National Library Of Finland)
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
 */const fetch = require('node-fetch');
const marc_record_converters = require('marc-record-converters');

async function readAuthorityRecord(connection, recordId) {
  return readRecord(connection, 'AUTH_DATA', 'AUTH_ID', recordId);
}

async function readBibRecord(connection, recordId) {
  return readRecord(connection, 'BIB_DATA', 'BIB_ID', recordId);
}

async function readRecord(connection, database, key, recordId) {

  const readQuery = `select utl_raw.CAST_TO_RAW(RECORD_SEGMENT) as SEG from fennicadb.${database} where ${key}=:id order by SEQNUM`;
  const recordSegments = await connection.execute(readQuery, [recordId]);
  const buffers = recordSegments.rows.map(row => row.SEG);
  const recordData = Buffer.concat(buffers).toString('utf-8');

  const record = marc_record_converters.iso2709.from(recordData);

  return record;
}


async function readBibRecordFromAPI(settings, recordId) {
  requireSettings(settings, ['batchcatFennica']);
  const requestUrl = `${settings.batchcatFennica}/bib/${recordId}`;
  const response = await fetch(requestUrl);
  if (response.status !== 200) {
    throw new Error(`Failed to load bib record ${recordId}: ${response.statusText}`);
  }
  const recordData = await response.text();
  
  const record = marc_record_converters.marc21slimXML.from(recordData);
  return record;
}

async function readAuthorityRecordFromAPI(settings, recordId) {
  requireSettings(settings, ['batchcatFennica']);
  const requestUrl = `${settings.batchcatFennica}/auth/${recordId}`;
  const response = await fetch(requestUrl);
  if (response.status !== 200) {
    throw new Error(`Failed to load auth record ${recordId}: ${response.statusText}`);
  }
  const recordData = await response.text();
  const record = marc_record_converters.marc21slimXML.from(recordData);
  return record;
}


async function saveAuthRecord(settings, recordId, record) {
  requireSettings(settings, ['batchcatFennica', 'catLocation', 'fennicaCredentials']);
  const recordData = marc_record_converters.marc21slimXML.to(record);
  
  const requestUrl = `${settings.batchcatFennica}/auth/${recordId}?catLocation=${settings.catLocation}`;

  const { username, password } = settings.fennicaCredentials;

  const headers = new fetch.Headers({
    'content-type': 'application/xml',
    'Authorization': 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64')
  });

  return fetch(requestUrl, { method: 'PUT', body: recordData, headers });
}


async function saveBibRecord(settings, recordId, record) {
  const recordData = marc_record_converters.marc21slimXML.to(record);
  requireSettings(settings, ['batchcatFennica', 'library', 'catLocation', 'fennicaCredentials']);
  const requestUrl = `${settings.batchcatFennica}/bib/${recordId}?library=${settings.library}&catLocation=${settings.catLocation}&opacSuppress=0`;

  const { username, password } = settings.fennicaCredentials;

  const headers = new fetch.Headers({
    'content-type': 'application/xml',
    'Authorization': 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64')
  });

  return fetch(requestUrl, { method: 'PUT', body: recordData, headers });
}

function requireSettings(settings, arrayOfParams) {
  arrayOfParams.forEach(key => {
    if (settings[key] === undefined) {
      throw new Error(`Missing required setting: ${key}`);
    }
  });
}

module.exports = {
  readAuthorityRecord,
  readBibRecord,
  saveAuthRecord,
  saveBibRecord,
  readBibRecordFromAPI,
  readAuthorityRecordFromAPI
};