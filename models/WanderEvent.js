import mongoose from 'mongoose';

const pointSchema = { lat: Number, lng: Number, accuracy: Number };

// One "patient is away from the safe area" episode, from the moment they leave until they are back.
//   active    away, and nobody has said they are with them
//   safe      a family caregiver said "they're with me, they're safe"
//   returned  the patient is back inside the safe area
//   ended     tracking was switched off or the safe area changed while away
const wanderSchema = new mongoose.Schema(
  {
    patient: { type: mongoose.Schema.Types.ObjectId, ref: 'Patient', required: true, index: true },
    open: { type: Boolean, default: true }, // true while status is active or safe
    status: { type: String, enum: ['active', 'safe', 'returned', 'ended'], default: 'active' },
    zoneLabel: { type: String, default: 'Home' },
    startedAt: { type: Date, default: Date.now },
    startLocation: pointSchema,
    lastLocation: pointSchema,
    lastSeenAt: { type: Date },
    maxDistanceM: { type: Number, default: 0 },
    alertId: { type: mongoose.Schema.Types.ObjectId, ref: 'Alert' },

    safeBy: { type: String },
    safeByName: { type: String },
    safeAt: { type: Date },
    safeNote: { type: String, maxlength: 200 },

    endedAt: { type: Date },
  },
  { timestamps: true }
);

wanderSchema.index({ patient: 1, startedAt: -1 });
// At most ONE open episode per patient, even if two location reports arrive at the same moment
wanderSchema.index({ patient: 1 }, { unique: true, partialFilterExpression: { open: true } });

export default mongoose.model('WanderEvent', wanderSchema);