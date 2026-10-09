import mongoose from 'mongoose';

const alertSchema = new mongoose.Schema({
  patient: { type: mongoose.Schema.Types.ObjectId, ref: 'Patient', index: true, required: true },
  type: { type: String, required: true }, // missed_medication | low_mood | inactivity | sos
  severity: { type: String, enum: ['info', 'warning', 'critical'], default: 'warning' },
  message: { type: String, required: true, maxlength: 300 },
  raisedAt: { type: Date, default: Date.now },
  resolvedAt: { type: Date, default: null },
  resolvedBy: { type: String },
  demo: { type: Boolean, default: false },
});

export default mongoose.model('Alert', alertSchema);
