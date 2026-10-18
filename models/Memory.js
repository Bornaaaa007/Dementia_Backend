import mongoose from 'mongoose';

// One "loved one" card shown to the patient: photo + name + relationship + short story
const memorySchema = new mongoose.Schema(
  {
    patient: { type: mongoose.Schema.Types.ObjectId, ref: 'Patient', index: true, required: true },
    name: { type: String, required: true, trim: true, maxlength: 60 },
    relationship: { type: String, required: true, trim: true, maxlength: 40 },
    story: { type: String, trim: true, maxlength: 600, default: '' },
    photoUrl: { type: String }, // small resized image stored as a data URL
    createdBy: { type: String, required: true }, // Better Auth user id of the family member who added it
  },
  { timestamps: true }
);

export default mongoose.model('Memory', memorySchema);