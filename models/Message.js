import mongoose from 'mongoose';

// Two kinds share this model:
//   kind 'message' = a text sent to the patient (has a read state)
//   kind 'jar'     = a short kind note stored in the Compliment & Encouragement Jar
const messageSchema = new mongoose.Schema(
  {
    patient: { type: mongoose.Schema.Types.ObjectId, ref: 'Patient', required: true },
    kind: { type: String, enum: ['message', 'jar'], default: 'message' },
    text: { type: String, required: true, trim: true, maxlength: 300 },
    senderId: { type: String, required: true }, // Better Auth user id
    senderName: { type: String, trim: true, maxlength: 80, default: 'Family' }, // shown to the patient
    readAt: { type: Date, default: null }, // messages: when the patient tapped "Got it"
    revealCount: { type: Number, default: 0 }, // jar: how often the note was shown
    lastRevealedAt: { type: Date },
  },
  { timestamps: true }
);

messageSchema.index({ patient: 1, kind: 1, createdAt: -1 });

export default mongoose.model('Message', messageSchema);