import mongoose from 'mongoose';

// A photo in the patient's memory gallery.
// photoUrl stores a resized base64 data URL, same pattern as Memory.photoUrl.
const galleryPhotoSchema = new mongoose.Schema(
  {
    patient:      { type: mongoose.Schema.Types.ObjectId, ref: 'Patient', index: true, required: true },
    photoUrl:     { type: String, required: true },
    caption:      { type: String, trim: true, maxlength: 200, default: '' },
    takenAt:      { type: String, trim: true, maxlength: 30, default: '' },  // e.g. "Summer 2019"
    linkedMemory: { type: mongoose.Schema.Types.ObjectId, ref: 'Memory', default: null },
    linkedSong:   { type: mongoose.Schema.Types.ObjectId, ref: 'Song',   default: null },
    addedBy:      { type: String, required: true },
  },
  { timestamps: true }
);

export default mongoose.model('GalleryPhoto', galleryPhotoSchema);