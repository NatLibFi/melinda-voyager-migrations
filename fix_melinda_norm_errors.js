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
 */const _ = require('lodash');
const fs = require('fs');
const RecordUtils = require('../../lib/record-utils');

const levenshtein = require('fast-levenshtein');


const data = fs.readFileSync('../melinda_norm_errors.txt', 'utf8');

const lines = data.split('\n');

let currentSet;
const sets = lines.reduce((acc, line) => {

  if (_.startsWith(line, 'ERROR')) {
    acc.push(currentSet);
    
    const match = /.*Query terms: (.*)/.exec(line);
    const [,query] = match;
    const firstQueryTerm = _.head(query.split(',')).substr(2);
    currentSet = [firstQueryTerm];
  }
  if (_.startsWith(line, '100')) {
    
    const match = /100....(.*)/.exec(line);
    const [,data] = match;
    const firstField = data.split('‡')[1].substr(1);
    currentSet.push(firstField);
  }
  return acc;
},[]);
sets.shift();

let counter = 0;
sets.forEach(set => {
  const query = _.head(set);
  const terms = _.tail(set).map(term => RecordUtils.normalizeForHeadingQuery(term)).filter(term => {
    return levenshtein.get(term, query) === 2;
  });

  if (terms.length === 0) {
    return;
  }

  // take levenstein distance and if it's not less than 3 then skip
  

  const match = terms.some(term => (_.includes(query, term) || _.includes(term, query)));
  if (match) {
    
  } else {
    const termsStr = terms.map(term => `${term}\n`);
    console.log(`Normalization failed\n${query}\n${termsStr}`);
    counter++;
  }
});

console.log(`Failed normalizations: ${counter}`);