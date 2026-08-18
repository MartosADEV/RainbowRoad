// Converts logo.png into a palette-index sprite string for the menu.
//
// Why not just embed the PNG? A PNG is already DEFLATE-compressed, so the jam
// zip cannot squeeze it further — a base64 PNG costs ~1.01x its own bytes. The
// same artwork as a palette-index string compresses several times over, scales
// at integer factors without blurring, and reuses the bake() pipeline every
// other sprite in the game already goes through.
//
// Usage:  node tools/logo.mjs            (survey sizes/palettes, measure cost)
//         node tools/logo.mjs 128 12     (emit the chosen width + colour count)
//
// REQUIRES logo.png in the repo root. That source art is NOT committed, so this
// tool cannot run on a fresh clone — the generated src/logo.js is committed
// instead and the build only needs that. Drop the original PNG back in the root
// if you ever want to re-derive the logo at a different size or palette.
import { readFileSync, writeFileSync } from 'fs';
import { inflateSync, deflateRawSync } from 'zlib';

// ---------------------------------------------------------------- PNG decode
function decodePng(buf) {
  let p = 8, w = 0, h = 0, ct = 0, bd = 0;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), type = buf.slice(p + 4, p + 8).toString('ascii');
    if (type === 'IHDR') {
      w = buf.readUInt32BE(p + 8); h = buf.readUInt32BE(p + 12);
      bd = buf[p + 16]; ct = buf[p + 17];
    } else if (type === 'IDAT') idat.push(buf.slice(p + 8, p + 8 + len));
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  if (bd !== 8 || ct !== 6) throw new Error('expected 8-bit RGBA, got bitDepth=' + bd + ' colorType=' + ct);
  const raw = inflateSync(Buffer.concat(idat));
  const bpp = 4, stride = w * bpp;
  const out = Buffer.alloc(h * stride);
  let q = 0;
  for (let y = 0; y < h; y++) {
    const f = raw[q++];
    const line = raw.slice(q, q + stride); q += stride;
    const prev = y ? out.slice((y - 1) * stride, y * stride) : Buffer.alloc(stride);
    const cur = out.slice(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0, b = prev[x], c = x >= bpp ? prev[x - bpp] : 0;
      let v = line[x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {                       // Paeth
        const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      cur[x] = v & 255;
    }
  }
  return { w, h, px: out };
}

// ---------------------------------------------------------------- crop + scale
function cropOpaque({ w, h, px }) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (px[(y * w + x) * 4 + 3] > 24) {
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  return { x0, y0, cw: x1 - x0 + 1, ch: y1 - y0 + 1 };
}

// Box-filter downscale. RGB is averaged weighted by alpha so transparent pixels
// do not drag the colour toward black at the edges.
function scale(src, box, tw, th) {
  const { w, px } = src, { x0, y0, cw, ch } = box;
  const out = new Array(tw * th);
  for (let ty = 0; ty < th; ty++) for (let tx = 0; tx < tw; tx++) {
    const sx0 = x0 + Math.floor(tx * cw / tw), sx1 = x0 + Math.floor((tx + 1) * cw / tw);
    const sy0 = y0 + Math.floor(ty * ch / th), sy1 = y0 + Math.floor((ty + 1) * ch / th);
    let r = 0, g = 0, b = 0, aw = 0, an = 0, n = 0;
    for (let y = sy0; y < Math.max(sy1, sy0 + 1); y++) for (let x = sx0; x < Math.max(sx1, sx0 + 1); x++) {
      const i = (y * w + x) * 4, a = px[i + 3];
      r += px[i] * a; g += px[i + 1] * a; b += px[i + 2] * a;
      aw += a; an += a; n++;
    }
    out[ty * tw + tx] = aw > 0
      ? { r: r / aw, g: g / aw, b: b / aw, a: an / n }
      : { r: 0, g: 0, b: 0, a: 0 };
  }
  return out;
}

// ---------------------------------------------------------------- quantise
function medianCut(pixels, k) {
  let boxes = [pixels.slice()];
  while (boxes.length < k) {
    let bi = -1, bw = -1;
    boxes.forEach((bx, i) => {
      if (bx.length < 2) return;
      const sp = ['r', 'g', 'b'].map(ch => {
        let lo = 255, hi = 0;
        for (const p of bx) { if (p[ch] < lo) lo = p[ch]; if (p[ch] > hi) hi = p[ch]; }
        return hi - lo;
      });
      const m = Math.max(...sp);
      if (m > bw) { bw = m; bi = i; }
    });
    if (bi < 0) break;
    const bx = boxes[bi];
    const sp = ['r', 'g', 'b'].map(ch => {
      let lo = 255, hi = 0;
      for (const p of bx) { if (p[ch] < lo) lo = p[ch]; if (p[ch] > hi) hi = p[ch]; }
      return hi - lo;
    });
    const ch = ['r', 'g', 'b'][sp.indexOf(Math.max(...sp))];
    bx.sort((a, b) => a[ch] - b[ch]);
    const mid = bx.length >> 1;
    boxes.splice(bi, 1, bx.slice(0, mid), bx.slice(mid));
  }
  return boxes.filter(b => b.length).map(b => {
    let r = 0, g = 0, bl = 0;
    for (const p of b) { r += p.r; g += p.g; bl += p.b; }
    return [Math.round(r / b.length), Math.round(g / b.length), Math.round(bl / b.length)];
  });
}

const hex = c => '#' + c.map(v => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('');
// index -> character, matching bake(): '1'-'9' then 'A'.. (charCode-55)
const chr = i => i < 10 ? String.fromCharCode(48 + i) : String.fromCharCode(55 + i);

function build(src, box, tw, colors, alphaCut = 128) {
  const th = Math.max(1, Math.round(tw * box.ch / box.cw));
  const sm = scale(src, box, tw, th);
  const opaque = sm.filter(p => p.a >= alphaCut);
  const pal = medianCut(opaque, colors);
  let d = '';
  for (const p of sm) {
    if (p.a < alphaCut) { d += '0'; continue; }
    let bi = 0, bd = 1e9;
    pal.forEach((c, i) => {
      const dr = p.r - c[0], dg = p.g - c[1], db = p.b - c[2];
      const dd = dr * dr * .3 + dg * dg * .59 + db * db * .11;
      if (dd < bd) { bd = dd; bi = i; }
    });
    d += chr(bi + 1);
  }
  return { w: tw, h: th, pal: pal.map(hex), d };
}

// ---------------------------------------------------------------- PNG encode (previews only)
function crc32(b) {
  let c, tb = [];
  for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; tb[n] = c; }
  let r = -1; for (const v of b) r = tb[(r ^ v) & 255] ^ (r >>> 8);
  return (r ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const cr = Buffer.alloc(4); cr.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, cr]);
}
function encodePng(w, h, rgba) {
  const stride = w * 4, raw = Buffer.alloc(h * (stride + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    chunk('IHDR', ihdr),
    chunk('IDAT', require$deflate(raw)),
    chunk('IEND', Buffer.alloc(0))
  ]);
}
import { deflateSync as require$deflate } from 'zlib';

// Render a built sprite back out as a big PNG so the result can be eyeballed.
function preview(r, zoom, file) {
  const W = r.w * zoom, H = r.h * zoom, out = Buffer.alloc(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const ch = r.d[((y / zoom) | 0) * r.w + ((x / zoom) | 0)];
    const i = (y * W + x) * 4;
    if (ch === '0') { out[i] = 24; out[i + 1] = 16; out[i + 2] = 40; out[i + 3] = 255; continue; }
    const v = ch.charCodeAt(0) - (ch <= '9' ? 48 : 55);
    const c = r.pal[v - 1];
    out[i] = parseInt(c.slice(1, 3), 16);
    out[i + 1] = parseInt(c.slice(3, 5), 16);
    out[i + 2] = parseInt(c.slice(5, 7), 16);
    out[i + 3] = 255;
  }
  writeFileSync(file, encodePng(W, H, out));
}

const src = decodePng(readFileSync(new URL('../logo.png', import.meta.url)));
const box = cropOpaque(src);
console.log('source ' + src.w + 'x' + src.h + ' -> opaque crop ' + box.cw + 'x' + box.ch +
  ' (aspect ' + (box.cw / box.ch).toFixed(2) + ':1)\n');

const [argW, argC] = process.argv.slice(2).map(Number);
if (argW) {
  const r = build(src, box, argW, argC || 12);
  const zipped = deflateRawSync(Buffer.from(r.d + r.pal.join()), { level: 9 }).length;
  const rows = [];
  for (let y = 0; y < r.h; y++) rows.push("  '" + r.d.slice(y * r.w, (y + 1) * r.w) + "'");
  const out = '// Generated by tools/logo.mjs from logo.png — do not hand-edit.\n' +
    '// ' + r.w + 'x' + r.h + ', ' + r.pal.length + ' colours.\n' +
    'const LOGO = bake(' + r.w + ", ['" + r.pal.join("', '") + "'],\n" +
    rows.join(' +\n') + ');\n';
  writeFileSync(new URL('../src/logo.js', import.meta.url), out);
  preview(r, 4, 'shots/logo-chosen.png');
  console.log('wrote src/logo.js — ' + r.w + 'x' + r.h + ', ' + r.pal.length +
    ' colours, ' + out.length + ' raw B, ~' + zipped + ' B zipped');
} else {
  console.log('width  size      colours  raw chars  zipped   preview');
  for (const [tw, c] of [[96, 12], [96, 16], [112, 12], [112, 16], [128, 8], [128, 12]]) {
    const r = build(src, box, tw, c);
    const zipped = deflateRawSync(Buffer.from(r.d + r.pal.join()), { level: 9 }).length;
    const f = 'shots/logo-' + tw + '-' + c + '.png';
    preview(r, 4, f);
    console.log(String(tw).padStart(5) + '  ' + (r.w + 'x' + r.h).padEnd(9) + ' ' +
      String(r.pal.length).padStart(6) + '  ' + String(r.d.length).padStart(9) + '  ' +
      String(zipped).padStart(5) + ' B   ' + f);
  }
  console.log('\nheadroom available: 2861 B');
}
