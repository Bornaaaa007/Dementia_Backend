// Validation for messages and jar notes. Pure functions, so they can be tested without a database.
export const LIMITS = { text: 300 };
export const KINDS = ['message', 'jar'];

export const readKind = (value) => (KINDS.includes(value) ? value : 'message');

export function readMessage(body = {}) {
  const kind = readKind(body.kind);
  const text = String(body.text ?? '').trim();
  if (!text) throw new Error(kind === 'jar' ? 'Write a kind note first' : 'Write a message first');
  if (text.length > LIMITS.text) throw new Error(`Please keep it to ${LIMITS.text} characters or fewer`);
  return { kind, text };
}