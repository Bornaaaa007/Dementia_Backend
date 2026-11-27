import mongoose from 'mongoose';

const tokenSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, index: true },
    token: { type: String, required: true, unique: true },
    platform: { type: String, enum: ['ios', 'android', 'web', 'unknown'], default: 'unknown' },
  },
  { timestamps: true }
);

export default mongoose.model('PushToken', tokenSchema);