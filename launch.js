const { spawn } = require('child_process');
const path = require('path');

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const electronBinary = require('electron');
const child = spawn(electronBinary, [__dirname], {
  env,
  stdio: 'inherit'
});

child.on('exit', (code) => process.exit(code ?? 0));
child.on('error', (err) => {
  console.error(err);
  process.exit(1);
});
