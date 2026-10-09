import mongoose from 'mongoose';

const patientSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    age: { type: Number, min: 0, max: 130 },
    dob: { type: String, trim: true, maxlength: 40 },
    photoUrl: { type: String },                   // small base64 data URL
    createdBy: { type: String, required: true },  // Better Auth user id (owner)
    members: { type: [String], default: [] },     // family members who joined
    inviteCode: { type: String },                 // family members use this to join
    pairCode: { type: String },                   // the patient's own device uses this
    deviceTokenHash: { type: String, select: false },
    pairedAt: { type: Date },
  },
  { timestamps: true }
);

export default mongoose.model('Patient', patientSchema);
