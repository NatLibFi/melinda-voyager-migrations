const voyagerRecordService = require('./voyager-record-service');
const _ = require('lodash');
const oracledb = require('oracledb');

const fs = require('fs');

const voyagerSettings = { 
  batchcatFennica: 'http://192.168.56.101:3004',
  library: '2', 
  catLocation: '95', 
  opacSuppress: 'N',
  fennicaCredentials: {
    username: 'petuomin',
    password: 'abcd1234'
  } 
};
oracledb.outFormat = oracledb.OBJECT;


const dbConfig = require('./dbconfiglahti');

run().catch(e => console.log(e));

async function run() {

  const connection = await oracledb.getConnection(dbConfig);

  const ids = _.range(112, 1000);
  for (let id of ids) {
    try {
      const bibAPI = await voyagerRecordService.readBibRecordFromAPI(voyagerSettings, id);
      const bibDB = await voyagerRecordService.readBibRecord(connection, id);

      if (bibAPI.toString() !== bibDB.toString()) {
        console.log(`Difference: bib_${id}_from_db.rec bib_${id}_from_api.rec`);
  
        fs.writeFileSync(`bib_${id}_from_db.rec`, bibDB.toString(), 'utf8');
        fs.writeFileSync(`bib_${id}_from_api.rec`, bibAPI.toString(), 'utf8');
        
      } else {
        console.log(`Same: bib ${id}`);
      }

    } catch(e) {
      console.log("Skipped " + id);
    }

    try {

      const authAPI = await voyagerRecordService.readAuthorityRecordFromAPI(voyagerSettings, id);
      const authDB = await voyagerRecordService.readAuthorityRecord(connection, id);


      if (authAPI.toString() !== authDB.toString()) {
        console.log(`Difference: auth_${id}_from_db.rec auth_${id}_from_api.rec`);
  
        fs.writeFileSync(`auth_${id}_from_db.rec`, authDB.toString(), 'utf8');
        fs.writeFileSync(`auth_${id}_from_api.rec`, authAPI.toString(), 'utf8');
        
      } else {
        console.log(`Same: auth ${id}`);
      }

    } catch(e) {
      console.log("Skipped " + id);
    }
  }
  
}


    