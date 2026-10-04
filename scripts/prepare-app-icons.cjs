'use strict';
// Export the generated artwork at platform sizes; no character drawing happens here.
const fs = require('node:fs');
const path = require('node:path');
const sharp = require(process.env.ICON_SHARP || 'C:/Users/ruofa/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp');
const root = path.resolve(__dirname, '..');
const spec = JSON.parse(fs.readFileSync(path.join(__dirname, 'app-icon-spec.json'), 'utf8'));

async function main() {
  const source = path.join(root, spec.sourceImage);
  const metadata = await sharp(source).metadata();
  if (metadata.width !== metadata.height) throw new Error('The generated app icon must be square.');
  for (const item of spec.exports) {
    let image = sharp(source).flatten({ background: '#07080c' });
    if (item.crop) {
      const [x, y, w, h] = item.crop;
      image = image.extract({ left: Math.round(x * metadata.width), top: Math.round(y * metadata.height),
        width: Math.round(w * metadata.width), height: Math.round(h * metadata.height) });
    }
    const output = path.join(root, item.file);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    await image.resize(item.size, item.size, { kernel: 'lanczos3' }).png({ compressionLevel: 9 }).toFile(output);
    console.log(`${item.file}: ${item.size} x ${item.size}`);
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
