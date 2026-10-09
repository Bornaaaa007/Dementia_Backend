import mongoose from 'mongoose';

// Everything that happens around the patient: check-ins, moods, notes, calls...
const activitySchema = new mongoose.Schema({
  patient: { type: mongoose.Schema.Types.ObjectId, ref: 'Patient', index: true, required: true },
  type: { type: String, required: true }, // app_open | mood | note | meal | walk | call | ...
  message: { type: String, maxlength: 500 },
  value: { type: Number },                // mood: 1-5
  at: { type: Date, default: Date.now, index: true },
  source: { type: String, enum: ['patient', 'caregiver', 'system'], default: 'system' },
  createdBy: { type: String },
  demo: { type: Boolean, default: false },
});

export default mongoose.model('Activity', activitySchema);
