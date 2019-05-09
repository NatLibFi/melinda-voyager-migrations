/* eslint no-console: 0 */

const _ = require('lodash');
const RecordUtils = require('../../../lib/record-utils');
const MigrationUtils = require('../migration-utils');
const fixBibRecordField = require('../fix-bib-record');
const MarcPunctuation = require('../../../lib/marc-punctuation-fix');
const Utils = require('../../../lib/utils');

const fs = require('fs');
const path = require('path');
const debug = require('debug')('task-handler-utils');

const bibRules = MarcPunctuation.readRulesFromCSV(fs.readFileSync(path.resolve(__dirname, '../../../lib/bib-punctuation.csv'), 'utf8'));
const fixPunctuationFromBibField = MarcPunctuation.createRecordFixer(bibRules);

class TaskError extends Error {
  constructor ( message ) {
    super();
    Error.captureStackTrace( this, this.constructor );
    this.name = 'TaskError';
    this.message = message;
  }
}

const dryRun = Utils.readEnvironmentVariable('NOOP', false) != false;


function readSettings() {

  if (process.env.TEST) {
    return {};
  }

  const XServerUrl = Utils.readEnvironmentVariable('MIGRATION_MELINDA_X_SERVER');
  const melindaEndpoint = Utils.readEnvironmentVariable('MIGRATION_MELINDA_API');

  const melindaCredentials = {
    username: Utils.readEnvironmentVariable('MIGRATION_MELINDA_USER'),
    password: Utils.readEnvironmentVariable('MIGRATION_MELINDA_PASS')
  };

  const batchcatFennica = Utils.readEnvironmentVariable('MIGRATION_BATCHCAT_FENNICA');
  const library = Utils.readEnvironmentVariable('MIGRATION_FENNICA_LIBRARY');
  const catLocation = Utils.readEnvironmentVariable('MIGRATION_FENNICA_CAT_LOCATION');

  const fennicaCredentials = {
    username: Utils.readEnvironmentVariable('MIGRATION_FENNICA_USER'),
    password: Utils.readEnvironmentVariable('MIGRATION_FENNICA_PASS')
  };

  return { XServerUrl, melindaEndpoint, melindaCredentials, batchcatFennica, library, catLocation, fennicaCredentials, dryRun };
}


function hasLink(field, expectedLinkValue) {
  
  // expectedLinkValue (FIN11) -> FI-ASTERI-N
  const alternateFormat = expectedLinkValue.startsWith('(FIN11)') ? '(FI-ASTERI-N)' + expectedLinkValue.substr(7) : null;

  const subfields = _.get(field, 'subfields', []);
  if (subfields.length > 0) {
    const subfield0 = subfields.filter(subfield => subfield.code === '0');
    
    if (subfield0.length === 0) {
      return false;
    }
    return subfield0.some(subfield => subfield.value === expectedLinkValue || subfield.value === alternateFormat);
  }
  return false;
}

function hasInvalidLink(field, expectedLinkValue, linkPrefix, linkValue) {
  
  // expectedLinkValue (FIN11) -> FI-ASTERI-N
  const alternateFormat = expectedLinkValue.startsWith('(FIN11)') ? '(FI-ASTERI-N)' + expectedLinkValue.substr(7) : null;

  const alternateFormatPrefix = linkPrefix === '(FIN11)' ? '(FI-ASTERI-N)' : null;

  const subfields = _.get(field, 'subfields', []);
    
 let hasInvalidLink = false;

  if (subfields.length > 0) {
    const subfield0 = subfields.filter(subfield => subfield.code === '0' && ((subfield.value.startsWith(linkPrefix) || (alternateFormatPrefix && (subfield.value.startsWith(alternateFormatPrefix))))));
    
    if (subfield0.length === 0) {
      return false;
    }
   
    return subfield0.some(subfield => subfield.value !== expectedLinkValue && subfield.value !== alternateFormat);  

/*
    hasInvalidLink =  subfield0.forEach( function(subfield) {
	  debug("Checking: ", subfield.value);
	  if ((subfield.value.startsWith(linkPrefix) || (alternateFormatPrefix && (subfield.value.startsWith(alternateFormatPrefix)))))  {
	      debug("Found prefixes: ", subfield.value);
              
	      if (subfield.value !== expectedLinkValue && subfield.value !== alternateFormat) {
		  debug("Link is invalid asteri-link: ", subfield.value);
		  return true;
	   }
	   else {
	   debug("Link is valid asteri-link: ", subfield.value);
	   }
       }
       else {
	   debug("Link is non-asteri-link: ", subfield.value);
       }

      });
      
  }

  debug("DEBUG: END", hasInvalidLink);  
  return hasInvalidLink;
*/
  }
    return false;
}

function validateLink(field, expectedLinkValue) {
  
  // expectedLinkValue (FIN11) -> FI-ASTERI-N
  const alternateFormat = expectedLinkValue.startsWith('(FIN11)') ? '(FI-ASTERI-N)' + expectedLinkValue.substr(7) : null;
  //debug("DEBUG: Searching field", field);  
  //debug("DEBUG: for linkValues:", expectedLinkValue+" "+alternateFormat);

  const subfields = _.get(field, 'subfields', []);

  if (subfields.length > 0) {
    return subfields.filter(subfield => subfield.code === '0').every(subfield => subfield.value === expectedLinkValue || subfield.value === alternateFormat);
  }
  return true;
}



function logFieldDiff(a, b) {
  const changedRecordFields = a.fields.map(RecordUtils.fieldToString);
  const originalRecordFields = b.fields.map(RecordUtils.fieldToString);
  const fieldsToRemove = _.difference(originalRecordFields, changedRecordFields);
  const fieldsToAdd = _.difference(changedRecordFields, originalRecordFields);

  if (fieldsToRemove.length > 0 || fieldsToAdd.length > 0) { 
    
      debug('DEBUG These fields', fieldsToRemove);
      debug('DEBUG are replaced by', fieldsToAdd);
  }

}

function errorLogger(params) {
  const { record1Type, record1, record2Type, record2, linkSourceRecordId, linkTargetRecordId, queryTermsString, db, dbType } = params;
  return function(error) {

    const logRecords = () => {
      console.log(`${record1Type}:`);
      console.log(record1.toString());
      console.log(`${record2Type}:`);
      console.log(record2.toString());
    };

    if (error instanceof MarcPunctuation.PunctuationError) {
      console.log(`ERROR ${db} ${dbType} ${linkSourceRecordId} \t ${error.name}: ${error.message}`);
      return;
    }

    if (error instanceof MigrationUtils.LinkingQueryError) {

      if (error.message === 'Found only 8XX field for linking.') {
        console.log(`WARN: Found only 8XX field from ${db} record ${linkSourceRecordId} to add the link to authority record ${linkTargetRecordId}. Query terms: ${queryTermsString}`);
        return;
      }
      console.log(`ERROR: Could not find field from ${db} record ${linkSourceRecordId} to add the link to authority record ${linkTargetRecordId}. Query terms: ${queryTermsString}`);
      logRecords();
      return;
    }

    console.log('ERROR: Unhandled error');
    console.log(error);
    logRecords();

  };
}


function fixBibField(db, linkPrefix, asteriId, fixedAuthorityRecord, bib_id, field) {

  const link = `${linkPrefix}${asteriId}`;

  // TODO: before fixing bib record field we have to ensure that we will not overwrite any current d subfields. Throw error if target contains d subfield with differing content.
  const fixedField = fixBibRecordField(field, fixedAuthorityRecord);
  fixPunctuationFromBibField(fixedField);
 
  if (!validateLink(fixedField, link)) {
    if (db != 'MELINDA') {   
      throw new TaskError(`Record ${db} bib_id ${bib_id} already has 0 link (${RecordUtils.fieldToString(fixedField)}) that is different from the one being added ${link}.`);
    }
    else {
	if (hasInvalidLink(fixedField, link, linkPrefix, asteriId)) {
	    //debug("hasInvalidLink returned true");
	    throw new TaskError(`Record ${db} bib_id ${bib_id} already has 0 link (${RecordUtils.fieldToString(fixedField)}) that is different from the one being added ${link}.`);
	}	
	console.log(`WARN: Record ${db} bib_id ${bib_id} already has 0 link (${RecordUtils.fieldToString(fixedField)}) that is different from the one being added ${link}.`);         	
    }
  }

  if (_.isEqual(field, fixedField)) {
    if (!hasLink(fixedField, link)) {
     
      const currentContent1 = RecordUtils.fieldToString(fixedField);
      console.log(`INFO ${db} bib_id ${bib_id} \t Adds $0 link without other changes (before adding):  ${currentContent1}`);	

      //RecordUtils.setSubfield(fixedField, '0', link, '9');
	RecordUtils.addSubfield(fixedField, '0', link, '9');

      const changedContent = RecordUtils.fieldToString(fixedField);
      console.log(`INFO ${db} bib_id ${bib_id} \t Adds $0 link without other changes:  ${changedContent}`);
    }
    else {
	debug('DEBUG: Has link already :',RecordUtils.fieldToString(fixedField));
    }

  } else {
    
    const currentContent = RecordUtils.fieldToString(field);
    const changedContent = RecordUtils.fieldToString(fixedField);

    if (!hasLink(fixedField, link)) {
	RecordUtils.addSubfield(fixedField, '0', link, '9');
    }
      else {
	debug('DEBUG: Has link already :',RecordUtils.fieldToString(fixedField));

      }

    const changedContentWithLink = RecordUtils.fieldToString(fixedField);
    
    //console.log(`INFO: I would link authority record ${auth_id} to bibliographic record ${bib_id} with $0 subfield in field ${field.tag} containing ${link}`);
    
    console.log(`WARN ${db} bib_id ${bib_id} \t Changes content in the field ${fixedField.tag}`);
    console.log(`WARN ${db} bib_id ${bib_id} \t Currently the content is: ${currentContent}`);
    console.log(`WARN ${db} bib_id ${bib_id} \t After update it becomes:  ${changedContent}`);
    console.log(`WARN ${db} bib_id ${bib_id} \t Adds $0 link:             ${changedContentWithLink}`);
  }

  return fixedField;
  
}

function recordsEqual(recordA, recordB) {
  return recordA.toString() === recordB.toString();
}

function updateUPDToY(record) {

//  console.log(`INFO Updating UPD field`);
  record.fields
    .filter(field => field.tag === 'UPD')
    .forEach(field => {
      field.subfields
        .filter(subfield => subfield.code === 'a' && subfield.value === 'N')
        .forEach(subfield => {
          subfield.value = 'Y';
        });
    });
}

module.exports = {
  validateLink,
  hasLink,
  logFieldDiff,
  TaskError,
  errorLogger,
  fixBibField,
  readSettings,
  recordsEqual,
  updateUPDToY
};
