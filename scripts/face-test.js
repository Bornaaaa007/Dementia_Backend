import fs from 'fs';
import { getDescriptor, distance } from '../lib/face.js';

const [a, b] = process.argv.slice(2);
if (!a) {
  console.log('Usage: node scripts/face-test.js photo1.jpg [photo2.jpg]');
  process.exit(1);
}

const toUri = (file) => `data:image/jpeg;base64,${fs.readFileSync(file).toString('base64')}`;

console.time('descriptor');
const d1 = await getDescriptor(toUri(a));
console.timeEnd('descriptor');
console.log('Face found. Descriptor length:', d1.length);

if (b) {
  const d2 = await getDescriptor(toUri(b));
  console.log('Distance between the two photos:', distance(d1, d2).toFixed(3));
}