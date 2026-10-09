import crypto from 'crypto';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I

export function makeCode(length) {
  const bytes = crypto.randomBytes(length);
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
}

export async function uniqueCode(Model, field, length) {
  for (let i = 0; i < 10; i++) {
    const code = makeCode(length);
    if (!(await Model.exists({ [field]: code }))) return code;
  }
  throw new Error('Could not generate a code, please try again');
}
