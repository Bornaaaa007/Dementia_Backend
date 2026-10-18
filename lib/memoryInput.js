export const LIMITS = { name: 60, relationship: 40, story: 600, photoChars: 1_200_000 };

const PHOTO_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;

export function readMemory(body = {}, { partial = false } = {}) {
  const out = {};
  const has = (key) => body[key] !== undefined;

  if (!partial || has('name')) {
    const name = String(body.name ?? '').trim();
    if (!name) throw new Error('Please enter their name');
    if (name.length > LIMITS.name) throw new Error(`Name must be ${LIMITS.name} characters or fewer`);
    out.name = name;
  }

  if (!partial || has('relationship')) {
    const relationship = String(body.relationship ?? '').trim();
    if (!relationship) throw new Error('Please enter how they are related to the patient');
    if (relationship.length > LIMITS.relationship) throw new Error(`Relationship must be ${LIMITS.relationship} characters or fewer`);
    out.relationship = relationship;
  }

  if (has('story')) {
    const story = String(body.story ?? '').trim();
    if (story.length > LIMITS.story) throw new Error(`The story must be ${LIMITS.story} characters or fewer`);
    out.story = story;
  }

  if (has('photoUrl')) {
    const photo = body.photoUrl;
    if (!photo) {
      out.photoUrl = undefined; // remove the photo
    } else {
      const text = String(photo);
      if (text.length > LIMITS.photoChars) throw new Error('That photo is too large. Choose a smaller one.');
      if (!PHOTO_RE.test(text)) throw new Error('The photo must be a JPEG, PNG or WebP image');
      out.photoUrl = text;
    }
  }
  return out;
}