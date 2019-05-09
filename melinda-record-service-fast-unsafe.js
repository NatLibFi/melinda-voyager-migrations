const AlephRecordService = require('../../lib/aleph-record-service');
const MelindaClient = require('melinda-api-client');
const RecordSerializers = require('marc-record-serializers');

function createMelindaRecordService(melindaEndpoint, XServer, credentials) {

  const client = new MelindaClient({
    endpoint: melindaEndpoint,
    user: credentials.username,
    password: credentials.password
  });
  
  const alephRecordServiceX = AlephRecordService.createAlephRecordService(XServer, credentials);

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
}

module.exports = { 
  createMelindaRecordService,
  AlephRecordError: AlephRecordService.AlephRecordError
};
