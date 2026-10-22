import mongoose from 'mongoose';

// One scheduled occurrence (e.g. "Morning medication" on 7 Oct at 08:00)
const reminderSchema = new mongoose.Schema({
  patient: { type: mongoose.Schema.Types.ObjectId, ref: 'Patient', index: true, required: true },
  title: { type: String, required: true, trim: true, maxlength: 120 },
  kind: { type: String, enum: ['medication', 'routine'], default: 'medication' },
  scheduledAt: { type: Date, required: true, index: true },
  status: { type: String, enum: ['pending', 'taken', 'missed'], default: 'pending' },
  actedAt: { type: Date },
  createdBy: { type: String },
  demo: { type: Boolean, default: false },

  // Week 8: reminders generated from a repeating schedule
  schedule: { type: mongoose.Schema.Types.ObjectId, ref: 'Schedule', index: true },
  slotKey: { type: String, index: { unique: true, sparse: true } }, // one reminder per schedule slot
  consumed: { type: Boolean, default: false },                      // pills already deducted for this dose
});

export default mongoose.model('Reminder', reminderSchema);