import mongoose from 'mongoose';

// One document per patient. Location sharing and tracking are OFF until the profile owner switches them on.
const safetySchema = new mongoose.Schema(
  {
    patient: { type: mongoose.Schema.Types.ObjectId, ref: 'Patient', required: true, unique: true },
    shareLocationOnSos: { type: Boolean, default: false },
    emergencyNumber: { type: String, default: '999', trim: true, maxlength: 20 }, // change for other countries

    // Live location + "away from the safe area" alerts
    trackingEnabled: { type: Boolean, default: false },
    safeZone: {
      label: { type: String, trim: true, maxlength: 40, default: 'Home' },
      lat: { type: Number },
      lng: { type: Number },
      radiusM: { type: Number, default: 150 },
    },
  },
  { timestamps: true }
);

export default mongoose.model('SafetySettings', safetySchema);
