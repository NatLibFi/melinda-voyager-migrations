/* eslint no-console: 0 */

const _ = require('lodash');
const MarcRecord = require('marc-record-js');

const RecordUtils = require('../../../lib/record-utils');
const MigrationUtils = require('../migration-utils');

const taskUtils = require('./task-handler-utils');

const voyagerRecordService = require('../voyager-record-service');
const { batchcatFennica, library, catLocation, fennicaCredentials, dryRun } = taskUtils.readSettings();
const voyagerSettings = { batchcatFennica, library, catLocation, fennicaCredentials };

// task -> Promise
async function handleFenauRecord(tasks) {
  const task = _.head(tasks);
  // fixedAuthorityRecord is the fenauRecord with it's years updated.
  const {asteriIdForLinking, fenauRecord, fenauRecordId, queryTermsForFieldSearch, queryTermsString, fixedAuthorityRecord} = task;
  const link = `(FI-ASTERI-N)${asteriIdForLinking}`;

  try {
          
    const fixedRecord = (fixedAuthorityRecord !== fenauRecord) ? 
      transformRecord(fenauRecord, fixedAuthorityRecord, link, fenauRecordId) :
      insertLinks(fenauRecord, link, queryTermsForFieldSearch, fenauRecordId);
    
    taskUtils.logFieldDiff(fixedRecord, fenauRecord);
    
    if (taskUtils.recordsEqual(fixedRecord, fenauRecord)) {
      console.log(`INFO FENAU auth_id ${fenauRecordId} \t No changes.`);
      return;
    }

    console.log(`INFO FENAU auth_id ${fenauRecordId} \t Saving record to fenau`);
    if (dryRun) {
      console.log(`INFO FENAU auth_id ${fenauRecordId} \t Dry run - not saving`);
      return;
    }

    return voyagerRecordService.saveAuthRecord(voyagerSettings, fenauRecordId, fixedRecord).then(res => {
      if (res.status < 200 || res.status >= 300) {
	  throw new taskUtils.TaskError(`FENAU auth_id ${fenauRecordId} saving failed \t ${res.status} ${res.statusText}`);
      }
	   console.log(`INFO FENAU auth_id ${fenauRecordId} \t Record saved successfully ${res.status} ${res.statusText}`);
      return res;
    });

  } catch(error) {
    if (error instanceof taskUtils.TaskError) {
      console.log(`ERROR: ${error.message}`);
    } else {
      console.log(error);
      console.log(`ERROR: Could not find field from authority record ${fenauRecordId} to add the link to authority record ${fenauRecordId}. Query terms: ${queryTermsString}`);

      console.log('AUTH:');
      console.log(fenauRecord.toString());
    }
    return error;
  }

}

function transformRecord(fenauRecord, fixedAuthorityRecord, link, fenauRecordId) {

  const originalAuthority100 = _.head(fenauRecord.getFields('100'));
  const fixedField = _.head(fixedAuthorityRecord.getFields('100'));

  if (!taskUtils.validateLink(fixedField, link)) {
    throw new taskUtils.TaskError(`Record ${fenauRecordId} already has 0 link (${RecordUtils.fieldToString(fixedField)}) that is different from the one being added ${link}.`);
  }
  
  if (!_.isEqual(originalAuthority100, fixedField)) {

    const currentAuthorityRecordContent = RecordUtils.fieldToString(originalAuthority100);
    const fixedAuthorityRecordContent = RecordUtils.fieldToString(fixedField);

    console.log(`WARN FENAU auth_id ${fenauRecordId} \t Currently the content is: ${currentAuthorityRecordContent}`);
    console.log(`WARN FENAU auth_id ${fenauRecordId} \t After update it becomes:  ${fixedAuthorityRecordContent}`);
  }
  
  if (!taskUtils.hasLink(fixedField, link)) {
    RecordUtils.setSubfield(fixedField, '0', link, '9');
    const fixedAuthorityRecordContent = RecordUtils.fieldToString(fixedField);
    console.log(`INFO FENAU auth_id ${fenauRecordId} \t Adds $0 link without other changes:  ${fixedAuthorityRecordContent}`);
  }

  return RecordUtils.mergeDuplicateFields(fixedAuthorityRecord);
}

function insertLinks(fenauRecord, link, queryTermsForFieldSearch, fenauRecordId) {

  const fixedRecord = MarcRecord.clone(fenauRecord);

  const fields = MigrationUtils.selectFieldForLinkingWithZero(fenauRecord, queryTermsForFieldSearch);
  
  fixedRecord.fields = fenauRecord.fields.map(field => {
    if (!_.includes(fields, field)) {
      return field;
    }

    const fixedField = _.cloneDeep(field);
    
    if (!taskUtils.validateLink(fixedField, link)) {  
      throw new taskUtils.TaskError(`Record ${fenauRecordId} already has 0 link (${RecordUtils.fieldToString(fixedField)}) that is different from the one being added ${link}.`);
    }

    if (!taskUtils.hasLink(fixedField, link)) {
      RecordUtils.setSubfield(fixedField, '0', link, '9');
      const changedContent = RecordUtils.fieldToString(fixedField);
      console.log(`INFO FENAU auth_id ${fenauRecordId} \t Adds $0 link without other changes:  ${changedContent}`);
    }

    return fixedField;
  });

  return RecordUtils.mergeDuplicateFields(fixedRecord);
}

module.exports = handleFenauRecord;
