const fs = require('fs');
const path = require('path');

['', 'main', 'preload'].forEach(dir => {
  const dirPath = dir ? path.join(__dirname, '..', 'dist-electron', dir) : path.join(__dirname, '..', 'dist-electron');
  if (fs.existsSync(dirPath)) {
    fs.readdirSync(dirPath)
      .filter(f => {
        const full = path.join(dirPath, f);
        return fs.statSync(full).isFile() && f.endsWith('.js');
      })
      .forEach(f => {
        const old = path.join(dirPath, f);
        const newf = path.join(dirPath, f.replace('.js', '.cjs'));
        
        let code = fs.readFileSync(old, 'utf8');
        // Replace require('./something') or require('../something') with .cjs
        code = code.replace(/require\(['"](\..*?)(?:\.cjs)?['"]\)/g, "require('$1.cjs')");
        fs.writeFileSync(old, code);
        
        if (old !== newf) {
          fs.renameSync(old, newf);
        }
        console.log('Processed ' + (dir ? dir + '/' : '') + f);
      });
  }
});
