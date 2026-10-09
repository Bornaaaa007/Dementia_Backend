import 'dotenv/config';
import { mongodbAdapter } from '@better-auth/mongo-adapter';
import { MongoClient } from 'mongodb';
import { createAuth } from './authConfig.js';

if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is missing');
if (!process.env.BETTER_AUTH_SECRET) throw new Error('BETTER_AUTH_SECRET is missing');

// Dedicated driver connection for Better Auth (collections: user, session, account, verification)
const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db();

export const auth = createAuth(mongodbAdapter(db, { client }));
