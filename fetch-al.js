import fs from 'fs';
fetch('https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/L-Alanine/JSON?record_type=2d')
  .then(r => r.json())
  .then(d => {
      fs.writeFileSync('l-alanine.json', JSON.stringify(d, null, 2));
      console.log('Saved');
  })
  .catch(console.error);
