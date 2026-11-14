import mongoose from 'mongoose';

// Someone the patient can call when they need help (family, neighbour, nurse...)
const contactSchema = new mongoose.Schema(
  {
    patient: { type: mongoose.Schema.Types.ObjectId, ref: 'Patient', required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 60 },
    phone: { type: String, required: true, trim: true, maxlength: 25 },
    relationship: { type: String, trim: true, maxlength: 40, default: '' },
    createdBy: { type: String, required: true },
  },
  { timestamps: true }
);

export default mongoose.model('TrustedContact', contactSchema);