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

const _ = require('lodash');
const MarcRecord = require('marc-record-js');

const RecordUtils = require('../../../lib/record-utils');
const MigrationUtils = require('../migration-utils');

const taskUtils = require('./task-handler-utils');

const MelindaRecordService = require('../../../lib/melinda-record-service');
const { XServerUrl, melindaEndpoint, melindaCredentials, dryRun } = taskUtils.readSettings();
const melindaRecordService = MelindaRecordService.createMelindaRecordService(melindaEndpoint, XServerUrl, melindaCredentials);

function handleAsteriRecordFix(fixPunctuationFromAuthField, tasks) {
  const task = _.head(tasks);
  const {asteriRecord, queryTermsForFieldSearch, asteriIdForLinking, fixedAuthorityRecord, queryTermsString} = task;
  
  const fixedRecord = MarcRecord.clone(asteriRecord);

  try {

//*    taskUtils.updateUPDToY(fixedRecord);
    
    const fields = MigrationUtils.selectFieldForLinkingWithZero(asteriRecord, queryTermsForFieldSearch);

    fixedRecord.fields = asteriRecord.fields.map(field => {
      if (!_.includes(fields, field)) {
        return field;
      }

      const link = `(FIN11)${asteriIdForLinking}`;

      const fixedField = _.cloneDeep(field);
      if (!taskUtils.validateLink(fixedField, link)) {  
        throw new taskUtils.TaskError(`Record ${asteriIdForLinking} already has 0 link (${RecordUtils.fieldToString(fixedField)}) that is different from the one being added ${link}.`);
      }

      if (field.tag === '100') {
        const fennicaAuthorizedPortion = MigrationUtils.selectAuthorizedPortion(fixedAuthorityRecord);
        MigrationUtils.setAuthorizedPortion(fixedField, fennicaAuthorizedPortion);
        fixPunctuationFromAuthField(fixedField);
      }
      if (_.isEqual(field, fixedField)) {
        if (!taskUtils.hasLink(fixedField, link)) {
          RecordUtils.setSubfield(fixedField, '0', link, '9');
          const changedContent = RecordUtils.fieldToString(fixedField);
          console.log(`INFO ASTERI auth_id ${asteriIdForLinking} \t Adds $0 link without other changes:  ${changedContent}`);
        }
      } else {
        
        const currentContent = RecordUtils.fieldToString(field);
        const changedContent = RecordUtils.fieldToString(fixedField);

        RecordUtils.setSubfield(fixedField, '0', link, '9');
        const changedContentWithLink = RecordUtils.fieldToString(fixedField);
        
        console.log(`WARN ASTERI auth_id ${asteriIdForLinking} \t Changes content in the field ${fixedField.tag}`);
        console.log(`WARN ASTERI auth_id ${asteriIdForLinking} \t Currently the content is: ${currentContent}`);
        console.log(`WARN ASTERI auth_id ${asteriIdForLinking} \t After update it becomes:  ${changedContent}`);
        console.log(`WARN ASTERI auth_id ${asteriIdForLinking} \t Adds $0 link:             ${changedContentWithLink}`);
      }

      return fixedField;

    });

    const compactedRecord = RecordUtils.mergeDuplicateFields(fixedRecord);
    taskUtils.updateUPDToY(compactedRecord);

    taskUtils.logFieldDiff(compactedRecord, asteriRecord);
    if (taskUtils.recordsEqual(compactedRecord, asteriRecord)) {
      console.log(`INFO ASTERI auth_id ${asteriIdForLinking} \t No changes.`);
      return;
    }

    console.log(`INFO ASTERI auth_id ${asteriIdForLinking} \t Saving record to asteri`);
    if (dryRun) {
      console.log(`INFO ASTERI auth_id ${asteriIdForLinking} \t Dry run - not saving`);
      return;
    }
    return melindaRecordService.saveRecord('fin11', asteriIdForLinking, compactedRecord).then(res => {
      console.log(`INFO ASTERI auth_id ${asteriIdForLinking} \t Record saved successfully`);
      return res;
    });

  } catch(error) {

    taskUtils.errorLogger({
      record1Type: 'ASTERI-AUTH', 
      record1: asteriRecord,
      record2Type: 'AUTH',
      record2: fixedAuthorityRecord,
      linkSourceRecordId: asteriIdForLinking,
      linkTargetRecordId: asteriIdForLinking,
      queryTermsString,
      db: 'ASTERI',
      dbType: 'auth_id'
    })(error);
  }
}

module.exports = handleAsteriRecordFix;
