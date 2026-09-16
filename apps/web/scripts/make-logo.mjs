/**
 * Regenerates public/logo-*.png from the source illustration.
 *
 * Run by hand, not by any check:
 *
 *     node apps/web/scripts/make-logo.mjs <source.png> apps/web/public
 *
 * **The 1024x1024 source is not committed** — it is 1,58 MB, and git is not
 * where a source asset that changes once a year belongs. Keep it wherever the
 * design lives; this script is what makes it reproducible without it having to
 * sit in the tree. The committed outputs came from it on 2026-09-16.
 *
 * What it does: crop the transparent margin off and emit small PNGs.
 *
 * No dependency. sharp would be ~10 MB of platform binaries for a job that runs
 * once, and this repo already hand-writes its database client rather than take
 * surface it does not need. Box filter on premultiplied alpha, which is the part
 * that matters: averaging straight RGBA against transparent black draws a dark
 * fringe around every edge.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { deflateSync, inflateSync } from 'node:zlib';

function decodePng(path) {
  const b = readFileSync(path);
  const w = b.readUInt32BE(16);
  const h = b.readUInt32BE(20);
  if (b[24] !== 8 || b[25] !== 6) throw new Error('only 8-bit RGBA is handled');
  const parts = [];
  let off = 8;
  while (off < b.length) {
    const len = b.readUInt32BE(off);
    const type = b.subarray(off + 4, off + 8).toString('ascii');
    if (type === 'IDAT') parts.push(b.subarray(off + 8, off + 8 + len));
    off += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(parts));
  const px = Buffer.alloc(w * h * 4);
  const stride = w * 4;
  let p = 0;
  for (let y = 0; y < h; y += 1) {
    const filter = raw[p];
    p += 1;
    const row = raw.subarray(p, p + stride);
    p += stride;
    const out = px.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x += 1) {
      const a = x >= 4 ? out[x - 4] : 0;
      const bb = y > 0 ? px[(y - 1) * stride + x] : 0;
      const c = x >= 4 && y > 0 ? px[(y - 1) * stride + x - 4] : 0;
      let v = row[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += bb;
      else if (filter === 3) v += (a + bb) >> 1;
      else if (filter === 4) {
        const pp = a + bb - c;
        const pa = Math.abs(pp - a);
        const pb = Math.abs(pp - bb);
        const pc = Math.abs(pp - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? bb : c;
      }
      out[x] = v & 0xff;
    }
  }
  return { w, h, px };
}

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(w, h, px) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const stride = w * 4;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y += 1) {
    raw[y * (stride + 1)] = 0;
    px.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** The tightest box holding anything visible, so the logo is not mostly margin. */
function bounds(w, h, px) {
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (px[(y * w + x) * 4 + 3] > 8) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return { x0, y0, x1, y1 };
}

/** Box filter over premultiplied alpha, then back. Avoids the dark fringe. */
function resize(src, sw, sh, box, size) {
  const out = Buffer.alloc(size * size * 4);
  const side = Math.max(box.x1 - box.x0 + 1, box.y1 - box.y0 + 1);
  // Square the crop so the logo keeps its proportions inside a square icon.
  const ox = box.x0 - Math.floor((side - (box.x1 - box.x0 + 1)) / 2);
  const oy = box.y0 - Math.floor((side - (box.y1 - box.y0 + 1)) / 2);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const sx0 = ox + Math.floor((x * side) / size);
      const sx1 = ox + Math.floor(((x + 1) * side) / size);
      const sy0 = oy + Math.floor((y * side) / size);
      const sy1 = oy + Math.floor(((y + 1) * side) / size);
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;
      for (let sy = sy0; sy < Math.max(sy1, sy0 + 1); sy += 1) {
        for (let sx = sx0; sx < Math.max(sx1, sx0 + 1); sx += 1) {
          n += 1;
          if (sx < 0 || sy < 0 || sx >= sw || sy >= sh) continue;
          const i = (sy * sw + sx) * 4;
          const al = src[i + 3] / 255;
          r += src[i] * al;
          g += src[i + 1] * al;
          b += src[i + 2] * al;
          a += src[i + 3];
        }
      }
      const o = (y * size + x) * 4;
      const am = a / n;
      const f = am > 0 ? 255 / am : 0;
      out[o] = Math.min(255, Math.round((r / n) * f));
      out[o + 1] = Math.min(255, Math.round((g / n) * f));
      out[o + 2] = Math.min(255, Math.round((b / n) * f));
      out[o + 3] = Math.round(am);
    }
  }
  return out;
}

const [, , input, outDir] = process.argv;
const { w, h, px } = decodePng(input);
const box = bounds(w, h, px);
console.log(`source ${w}x${h}, visible box ${box.x0},${box.y0} -> ${box.x1},${box.y1}`);

// 32 for the tab, 64 for the header on a 2x screen, 180 for an iOS home
// screen. A 512 was generated first and dropped: 409 KB for an icon nothing on
// this site requests, since the page is noindex and password-gated so there is
// no social card to feed.
for (const size of [32, 64, 180]) {
  const out = resize(px, w, h, box, size);
  const png = encodePng(size, size, out);
  const name = `${outDir}/logo-${size}.png`;
  writeFileSync(name, png);
  console.log(`  logo-${size}.png  ${String(png.length).padStart(7)} bytes`);
}
