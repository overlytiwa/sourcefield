// Native icon formats are rendered from the editable SVG masters; no source PNG.
import sharp from 'sharp';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const sizes = [16, 24, 32, 48, 64, 128, 256, 512, 1024];
const full = await readFile('resources/icon.svg');
await mkdir('resources/icons/linux', { recursive: true });
const png = new Map(await Promise.all(sizes.map(async size => {
  const data = await sharp(full, { density: 192 }).resize(size, size).png().toBuffer();
  await writeFile(`resources/icons/linux/${size}x${size}.png`, data);
  return [size, data];
})));
await writeFile('resources/icons/icon.png', png.get(1024));

// ICO image directory followed by PNG-encoded images, including the 256px entry.
const icoSizes = sizes.filter(size => size <= 256);
const directory = Buffer.alloc(6 + icoSizes.length * 16);
directory.writeUInt16LE(1, 2); directory.writeUInt16LE(icoSizes.length, 4);
let offset = directory.length;
icoSizes.forEach((size, i) => {
  const at = 6 + i * 16, bytes = png.get(size);
  directory[at] = size === 256 ? 0 : size; directory[at + 1] = directory[at];
  directory.writeUInt16LE(1, at + 4); directory.writeUInt16LE(32, at + 6);
  directory.writeUInt32LE(bytes.length, at + 8); directory.writeUInt32LE(offset, at + 12);
  offset += bytes.length;
});
await writeFile('resources/icons/icon.ico', Buffer.concat([directory, ...icoSizes.map(size => png.get(size))]));

// Modern macOS ICNS PNG chunks, including Retina representations.
const icnsTypes = [['icp4', 16], ['icp5', 32], ['icp6', 64], ['ic07', 128], ['ic08', 256], ['ic09', 512], ['ic10', 1024], ['ic11', 32], ['ic12', 64], ['ic13', 256], ['ic14', 512]];
const chunks = icnsTypes.map(([type, size]) => {
  const image = png.get(size), header = Buffer.alloc(8);
  header.write(type, 0, 4, 'ascii'); header.writeUInt32BE(image.length + 8, 4);
  return Buffer.concat([header, image]);
});
const header = Buffer.alloc(8); header.write('icns', 0, 4, 'ascii');
header.writeUInt32BE(8 + chunks.reduce((sum, chunk) => sum + chunk.length, 0), 4);
await writeFile('resources/icons/icon.icns', Buffer.concat([header, ...chunks]));
console.log('Built PNG, multi-size Windows ICO, macOS ICNS, and Linux icon sizes.');
