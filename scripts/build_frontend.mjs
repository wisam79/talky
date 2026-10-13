import { build } from 'esbuild';

await build({
  entryPoints: ['scripts/vendor_entry.js'],
  bundle: true,
  minify: true,
  format: 'iife',
  outfile: 'static/js/vendor.js',
  target: ['es2020'],
  legalComments: 'none',
});
