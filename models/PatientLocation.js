import mongoose from 'mongoose';

// The patient's LATEST position only (one document per patient, overwritten on every report).
// No location history is kept, on purpose.
const locationSchema = new mongoose.Schema(
  {
    patient: { type: mongoose.Schema.Types.ObjectId, ref: 'Patient', required: true, unique: true },
    lat: { type: Number, required: true },
    lng: { type: Number, required: true },
    accuracy: { type: Number },
    recordedAt: { type: Date, required: true },
    // consecutive confident readings outside / inside the safe area (stops one bad GPS reading from raising an alert)
    outsideStreak: { type: Number, default: 0 },
    insideStreak: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export default mongoose.model('PatientLocation', locationSchema);
