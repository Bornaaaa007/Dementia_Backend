import mongoose from 'mongoose';

export default async function connectDB() {
  if (!process.env.MONGODB_URI) {
    throw new Error('MONGODB_URI is missing. Create a .env file (see .env.example).');
  }
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('MongoDB connected');
}
