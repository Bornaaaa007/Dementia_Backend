import mongoose from 'mongoose';

const alertSchema = new mongoose.Schema({
  patient: { type: mongoose.Schema.Types.ObjectId, ref: 'Patient', index: true, required: true },
  // missed_medication | missed_day | low_supply | low_mood | high_pain | inactivity | sos
  type: { type: String, required: true },
  severity: { type: String, enum: ['info', 'warning', 'critical'], default: 'warning' },
  message: { type: String, required: true, maxlength: 300 },
  ref: { type: String, index: true }, // e.g. "supply:<scheduleId>", so one alert per medicine
  raisedAt: { type: Date, default: Date.now },
  resolvedAt: { type: Date, default: null },
  resolvedBy: { type: String },
  demo: { type: Boolean, default: false },
});

export default mongoose.model('Alert', alertSchema);