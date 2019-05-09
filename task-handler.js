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
 *//* eslint no-console: 0 */

const fs = require('fs');

const Constants = require('./constants');
const TASK_TYPES = Constants.TASK_TYPES;

const MarcPunctuation = require('@natlibfi/melinda-marc-record-utils/dist/punctuation');

const authRules = MarcPunctuation.readPunctuationRulesFromJSON(require('@natlibfi/melinda-marc-record-utils/dist/punctuation/auth-punctuation.json'));

const fixPunctuationFromAuthField = MarcPunctuation.createRecordFixer(authRules, MarcPunctuation.RecordTypes.AUTHORITY);

const handleFenauRecord = require('./task-handlers/fenau');
const handleLinkedFenauRecord = require('./task-handlers/linked-fenau');
const handleLinkedAsteriRecord = require('./task-handlers/linked-asteri');
const handleAsteriRecordFix = require('./task-handlers/asteri');
const handleMelindaRecord = require('./task-handlers/melinda');
const handleFenniRecord = require('./task-handlers/fenni');

function TaskHandler(alephRecordService, voyagerRecordService) {

  function createLinkings(tasks, taskType) {

    if (taskType === TASK_TYPES.FENAU_ASTERI) {
      return handleFenauRecord(tasks);
    }

    if (taskType === TASK_TYPES.LINKED_FENAU_ASTERI) {
      return handleLinkedFenauRecord(fixPunctuationFromAuthField, tasks);
    }

    if (taskType === TASK_TYPES.FENNI_ASTERI) {
      return handleFenniRecord(tasks);
    }

    if (taskType === TASK_TYPES.LINKED_ASTERI_ASTERI) {
      return handleLinkedAsteriRecord(fixPunctuationFromAuthField, tasks);
    }

    if (taskType === TASK_TYPES.ASTERI_ASTERI) {
      return handleAsteriRecordFix(fixPunctuationFromAuthField, tasks);
    }

    if (taskType === TASK_TYPES.MELINDA_ASTERI) {
      return handleMelindaRecord(tasks);
    }
    throw new Error(`Unable to find handler for task ${taskType}`);
  }

  return createLinkings;

}

module.exports = TaskHandler;
