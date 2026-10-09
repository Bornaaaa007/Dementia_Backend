import mongoose from 'mongoose';

const settingsSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, unique: true },
    staleAfterHours: { type: Number, default: 24, min: 1, max: 168 },
    notifyMissedMeds: { type: Boolean, default: true },
    notifyMoodDrops: { type: Boolean, default: true },
    notifyInactivity: { type: Boolean, default: true },
    lastPatientId: { type: String },
  },
  { timestamps: true }
);

export default mongoose.model('CaregiverSettings', settingsSchema);
