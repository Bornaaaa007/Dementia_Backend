import mongoose from 'mongoose';

// One document per patient. Location sharing is OFF until the profile owner switches it on.
const safetySchema = new mongoose.Schema(
  {
    patient: { type: mongoose.Schema.Types.ObjectId, ref: 'Patient', required: true, unique: true },
    shareLocationOnSos: { type: Boolean, default: false },
    emergencyNumber: { type: String, default: '999', trim: true, maxlength: 20 }, // change for other countries
  },
  { timestamps: true }
);

export default mongoose.model('SafetySettings', safetySchema);