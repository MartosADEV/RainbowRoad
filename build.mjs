// Build: minify src/game.js, inline it into src/index.html, emit dist/index.html
// and a deterministic dist/game.zip. The ZIP is what counts against the jam limit.
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { deflateRawSync, crc32 } from 'zlib';
import { minify } from 'terser';

const LIMIT = 13312; // js13kgames: 13 * 1024 bytes, zipped

// //DBG lines are dev-only instrumentation and never ship.
// //LOGO is replaced by the generated sprite from tools/logo.mjs, kept in its
// own file so game.js stays readable and the logo can be re-derived at will.
const logo = readFileSync('src/logo.js', 'utf8');
const js = readFileSync('src/game.js', 'utf8')
  .split('\n').filter(l => !l.trim().startsWith('//DBG')).join('\n')
  .replace('//LOGO', () => logo);
const html = readFileSync('src/index.html', 'utf8');

const min = await minify(js, {
  ecma: 2020,
  toplevel: true,
  mangle: { toplevel: true },
  compress: {
    passes: 3,
    unsafe: true,
    unsafe_arrows: true,
    unsafe_math: true,
    booleans_as_integers: true,
    pure_getters: true,
    hoist_funs: true,
  },
  format: { comments: false },
});
if (min.error) throw min.error;

// Collapse the shell BEFORE inlining, so these regexes never touch the game code.
const shell = html
  .replace(/\n\s*/g, '')      // indentation
  .replace(/;\s*}/g, '}');    // trailing semicolons in the inline CSS

// NOTE: the replacement must be a function. A string replacement would interpret
// `$&` / `$'` sequences inside the minified code as substitution patterns.
const inline = (s, code) => s.replace('<!--GAME-->', () => '<script>' + code + '</script>');

const out = inline(shell, min.code);

mkdirSync('dist', { recursive: true });
writeFileSync('dist/index.html', out);
// unminified twin with the //DBG instrumentation left in, for the test harness
writeFileSync('dist/dev.html', inline(html, readFileSync('src/game.js', 'utf8')
  .replace(/^\s*\/\/DBG /gm, '').replace('//LOGO', () => logo)));

// --- minimal ZIP writer (stored central directory, deflate-raw payload) ---
const name = Buffer.from('index.html');
const data = Buffer.from(out);
const comp = deflateRawSync(data, { level: 9 });
const sum = crc32 ? crc32(data) : crcFallback(data);

const local = Buffer.alloc(30);
local.writeUInt32LE(0x04034b50, 0);
local.writeUInt16LE(20, 4);   // version needed
local.writeUInt16LE(0, 6);    // flags
local.writeUInt16LE(8, 8);    // deflate
local.writeUInt16LE(0, 10);   // time (fixed -> deterministic builds)
local.writeUInt16LE(0x21, 12); // date
local.writeUInt32LE(sum, 14);
local.writeUInt32LE(comp.length, 18);
local.writeUInt32LE(data.length, 22);
local.writeUInt16LE(name.length, 26);
local.writeUInt16LE(0, 28);

const central = Buffer.alloc(46);
central.writeUInt32LE(0x02014b50, 0);
central.writeUInt16LE(20, 4);
central.writeUInt16LE(20, 6);
central.writeUInt16LE(0, 8);
central.writeUInt16LE(8, 10);
central.writeUInt16LE(0, 12);
central.writeUInt16LE(0x21, 14);
central.writeUInt32LE(sum, 16);
central.writeUInt32LE(comp.length, 20);
central.writeUInt32LE(data.length, 24);
central.writeUInt16LE(name.length, 28);
central.writeUInt32LE(0, 38); // external attrs
central.writeUInt32LE(0, 42); // offset of local header

const cdSize = central.length + name.length;
const cdOffset = local.length + name.length + comp.length;

const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(1, 8);
end.writeUInt16LE(1, 10);
end.writeUInt32LE(cdSize, 12);
end.writeUInt32LE(cdOffset, 16);

const zip = Buffer.concat([local, name, comp, central, name, end]);
writeFileSync('dist/game.zip', zip);

function crcFallback(buf) {
  let c, t = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  let r = -1;
  for (const b of buf) r = t[(r ^ b) & 0xff] ^ (r >>> 8);
  return (r ^ -1) >>> 0;
}

// guard: the shipped script must actually parse
try { new Function(out.slice(out.indexOf('<script>') + 8, out.lastIndexOf('</script>'))); }
catch (e) { console.error('\n  BUILD PRODUCED INVALID JS: ' + e.message + '\n'); process.exit(1); }

const pct = ((zip.length / LIMIT) * 100).toFixed(1);
const pad = (s, n) => String(s).padStart(n);
console.log(`
  game.js  (source)   ${pad(js.length, 7)} B
  game.js  (minified) ${pad(min.code.length, 7)} B
  index.html (dist)   ${pad(out.length, 7)} B
  ------------------------------------
  game.zip            ${pad(zip.length, 7)} B  /  ${LIMIT} B   (${pct}%)
  headroom            ${pad(LIMIT - zip.length, 7)} B
`);

if (zip.length > LIMIT) {
  console.error('  OVER BUDGET\n');
  process.exit(1);
}
