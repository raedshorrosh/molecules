import fs from 'fs';
fetch('https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/5793/JSON')
  .then(r => r.json())
  .then(d => {
      console.log(d);
  })
  .catch(console.error);
