import mongoose from 'mongoose';

const sosSchema = new mongoose.Schema(
  {
    patient: { type: mongoose.Schema.Types.ObjectId, ref: 'Patient', required: true, index: true },
    type: { type: String, enum: ['help', 'emergency'], default: 'help' },
    status: { type: String, enum: ['active', 'acknowledged', 'cancelled', 'resolved'], default: 'active' },
    locationStatus: { type: String, enum: ['off', 'shared', 'denied', 'unavailable'], default: 'off' },
    location: { lat: Number, lng: Number, accuracy: Number },
    notifiedCount: { type: Number, default: 0 }, // how many family accounts can see this request
    alertId: { type: mongoose.Schema.Types.ObjectId, ref: 'Alert' },
    acknowledgedBy: { type: String },
    acknowledgedAt: { type: Date },
    cancelledAt: { type: Date },
    resolvedAt: { type: Date },
  },
  { timestamps: true }
);

sosSchema.index({ patient: 1, createdAt: -1 });

export default mongoose.model('SosEvent', sosSchema);