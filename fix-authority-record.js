const _ = require('lodash');
const fs = require('fs');
const debug = require('debug')('fix-authority-record');

const MarcRecord = require('marc-record-js');
const recordUtils = require('../../lib/record-utils');

const MarcPunctuation = require('../../lib/marc-punctuation-fix');

const authRules =  MarcPunctuation.readRulesFromCSV(fs.readFileSync('../../lib/auth-punctuation.csv', 'utf8'));

const fixPunctuationFromAuthField = MarcPunctuation.createRecordFixer(authRules, MarcPunctuation.RecordTypes.AUTHORITY);

function fixAuthorityRecordYears(inputRecord) {
  const record = new MarcRecord(inputRecord);

  const field100 = _.head(record.getFields('100'));
  if (field100 === undefined) {
    return record;
  }

  const yearOfBirthFrom046f = recordUtils.selectBirthYear(record);
  const yearOfDeathFrom046g = recordUtils.selectDeathYear(record);

  debug("DEBUG: 046 : ", yearOfBirthFrom046f+", "+yearOfDeathFrom046g);   
  
  // parse birth/death from 100d - note: this loses everything after second hyphen and also non-ASCII-characters
  const [birth, death] = recordUtils.parseYearsFrom100d(record);
 
  debug("DEBUG: 100d : ", birth+", "+death);   

  // all defined years must contain only numbers.
  if (!_.compact([yearOfBirthFrom046f, yearOfDeathFrom046g, birth, death]).every(year => /^\d+$/.test(year))) {
    return record;
  }

  if (yearOfBirthFrom046f && birth && yearOfBirthFrom046f !== birth) {
    throw new Error('Record has year of birth in 046f and 100d and they are mismatched');
  }
  if (yearOfDeathFrom046g && death && yearOfDeathFrom046g !== death) {
    throw new Error('Record has year of death in 046g and 100d and they are mismatched');
  }
   

  const yearOfBirth = yearOfBirthFrom046f || birth;
  const yearOfDeath = yearOfDeathFrom046g || death;

  const updatedFieldDContent = create100d(yearOfBirth, yearOfDeath);

  if (updatedFieldDContent) {
    recordUtils.setSubfield(field100, 'd', updatedFieldDContent, 'j');
    fixPunctuationFromAuthField(field100);
    record.getFields('400').forEach(field400 => {
      recordUtils.setSubfield(field400, 'd', updatedFieldDContent, 'j');
      fixPunctuationFromAuthField(field400);
    });
  }
  
  return record;
}

function create100d(birth, death) {
  if (birth && death) {
    return `${birth}-${death}`;
  }
  if (birth) {
    return `${birth}-`;
  }
  if (death) {
    return `-${death}`;
  }
}

module.exports = fixAuthorityRecordYears;
