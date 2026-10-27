// Gera o preload da interface (inclui o elemento <browser-action-list> das extensões).
require('esbuild').buildSync({
  entryPoints: ['src/preload-ui.js'],
  bundle: true,
  platform: 'node',
  external: ['electron'],
  outfile: 'build/preload-ui.js',
  target: 'node22',
  logLevel: 'warning'
});
console.log('preload pronto');
