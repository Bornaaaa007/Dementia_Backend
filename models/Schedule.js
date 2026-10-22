import mongoose from 'mongoose';

// A repeating plan: "Metformin 500 mg at 08:00 and 20:00" or "Afternoon walk at 16:30".
// Today's and tomorrow's individual Reminder documents are generated from it.
const scheduleSchema = new mongoose.Schema(
  {
    patient: { type: mongoose.Schema.Types.ObjectId, ref: 'Patient', index: true, required: true },
    kind: { type: String, enum: ['medication', 'routine'], default: 'medication' },
    title: { type: String, required: true, trim: true, maxlength: 120 },
    dose: { type: String, trim: true, maxlength: 60 },
    times: { type: [String], default: [] },          // "HH:MM", 24-hour, local time
    tzOffsetMinutes: { type: Number, default: 0 },   // from the family's phone (Dhaka = -360)
    active: { type: Boolean, default: true },
    // Supply tracking (medicines only). null = pills are not counted.
    pillsRemaining: { type: Number, default: null },
    pillsPerDose: { type: Number, default: 1 },
    lastRefillAt: { type: Date },
    createdBy: { type: String },
  },
  { timestamps: true }
);

export default mongoose.model('Schedule', scheduleSchema);