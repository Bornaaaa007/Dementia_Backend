import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const MODEL_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'node_modules',
  '@vladmandic',
  'face-api',
  'model'
);

// Lower = stricter. Same person is usually under 0.5; different people are usually above 0.6.
export const THRESHOLD = Number(process.env.FACE_MATCH_THRESHOLD || 0.5);

export class FaceError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

// Everything heavy is loaded lazily so a library problem can't stop the server from starting.
let engine = null;
function loadEngine() {
  if (!engine) {
    engine = (async () => {
      const tf = require('@tensorflow/tfjs');
      require('@tensorflow/tfjs-backend-wasm');
      const faceapi = require('@vladmandic/face-api/dist/face-api.node-wasm.js');
      const sharp = (await import('sharp')).default;

      const wasmOk = await tf.setBackend('wasm').catch(() => false);
      if (!wasmOk) await tf.setBackend('cpu'); // slower, but works everywhere
      await tf.ready();

      await faceapi.nets.ssdMobilenetv1.loadFromDisk(MODEL_DIR);
      await faceapi.nets.faceLandmark68Net.loadFromDisk(MODEL_DIR);
      await faceapi.nets.faceRecognitionNet.loadFromDisk(MODEL_DIR);
      console.log(`[face] ready (backend: ${tf.getBackend()})`);
      return { tf, faceapi, sharp };
    })().catch((err) => {
      engine = null;
      throw err;
    });
  }
  return engine;
}

export const warmUp = () => loadEngine();

async function toTensor(dataUri, tf, sharp) {
  const base64 = String(dataUri || '').replace(/^data:image\/[\w+.-]+;base64,/, '');
  const input = Buffer.from(base64, 'base64');
  if (input.length < 1000) throw new FaceError('BAD_IMAGE', 'That photo could not be read. Please try again.');
  try {
    // rotate() applies the phone's EXIF orientation; resize keeps detection fast
    const { data, info } = await sharp(input)
      .rotate()
      .resize({ width: 640, height: 640, fit: 'inside', withoutEnlargement: true })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    return tf.tensor3d(Int32Array.from(data), [info.height, info.width, 3], 'int32');
  } catch {
    throw new FaceError('BAD_IMAGE', 'That photo could not be read. Please try again.');
  }
}

// Returns the 128-number face descriptor for the one face in the photo.
export async function getDescriptor(dataUri) {
  const { tf, faceapi, sharp } = await loadEngine();
  const tensor = await toTensor(dataUri, tf, sharp);
  try {
    const results = await faceapi
      .detectAllFaces(tensor, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.5 }))
      .withFaceLandmarks()
      .withFaceDescriptors();
    if (results.length === 0) throw new FaceError('NO_FACE', "I couldn't see a face. Try again in better light.");
    if (results.length > 1) throw new FaceError('MULTIPLE_FACES', 'Please make sure only one person is in the picture.');
    return Array.from(results[0].descriptor);
  } finally {
    tensor.dispose();
  }
}

export function distance(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return Math.sqrt(sum);
}

export const bestDistance = (descriptor, enrolled) => Math.min(...enrolled.map((e) => distance(descriptor, e)));