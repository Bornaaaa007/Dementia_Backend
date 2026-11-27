import mongoose from 'mongoose';

// Expo push tokens of the family members' phones
const tokenSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, index: true }, // Better Auth user id
    token: { type: String, required: true, unique: true },
    platform: { type: String, enum: ['ios', 'android', 'web', 'unknown'], default: 'unknown' },
  },
  { timestamps: true }
);

export default mongoose.model('PushToken', tokenSchema);
