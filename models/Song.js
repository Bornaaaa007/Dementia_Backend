import mongoose from 'mongoose';

// A song the family uploads for the patient's Memory Jukebox.
// audioUrl stores a base64 data URL (small files only) or a remote URL.
const songSchema = new mongoose.Schema(
  {
    patient:       { type: mongoose.Schema.Types.ObjectId, ref: 'Patient', index: true, required: true },
    title:         { type: String, required: true, trim: true, maxlength: 120 },
    artist:        { type: String, trim: true, maxlength: 80, default: '' },
    audioUrl:      { type: String, default: null },   // base64 data URL or remote URL
    linkedMemory:  { type: mongoose.Schema.Types.ObjectId, ref: 'Memory', default: null }, // optional pairing
    note:          { type: String, trim: true, maxlength: 300, default: '' }, // "This was Grandma's favourite"
    addedBy:       { type: String, required: true }, // Better Auth user id
    playCount:     { type: Number, default: 0 },
    lastPlayedAt:  { type: Date, default: null },
  },
  { timestamps: true }
);

export default mongoose.model('Song', songSchema);