import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { toNodeHandler } from 'better-auth/node';
import connectDB from './config/db.js';
import { auth } from './lib/auth.js';
import { makeRequireAuth } from './middleware/requireAuth.js';
import patientRoutes from './routes/patients.js';
import settingsRoutes from './routes/settings.js';
import deviceRoutes from './routes/device.js';

const app = express();
const requireAuth = makeRequireAuth(auth);

const origins = (process.env.CORS_ORIGINS || '').split(',').filter(Boolean);
app.use(origins.length ? cors({ origin: origins, credentials: true }) : cors());

// Better Auth handler MUST come before express.json()
app.all('/api/auth/*splat', toNodeHandler(auth));

app.use(express.json({ limit: '3mb' })); // patient photos are sent as small base64 images

app.get('/', (req, res) => res.json({ status: 'NestCare API running' }));
app.get('/api/me', requireAuth, (req, res) => res.json({ user: req.user }));
app.get('/api/users', async (req, res) => {
  const users = await db.collection('user').find({}, { projection: { password: 0 } }).toArray();
  res.json({ users });
});
// Family / caregiver accounts
app.use('/api/patients', requireAuth, patientRoutes);
app.use('/patients', requireAuth, patientRoutes); // same routes without /api, for older screens
app.use('/api/settings', requireAuth, settingsRoutes);

// Patient device (token from pairing, no email/password)
app.use('/api/patient-device', deviceRoutes);

// JSON errors (e.g. photo too large) instead of an HTML page
app.use((err, req, res, next) => {
  if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'That photo is too large, choose a smaller one' });
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid request body' });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong' });
});

const PORT = process.env.PORT || 5000;

connectDB()
  .then(() => app.listen(PORT, '0.0.0.0', () => console.log(`Server on port ${PORT}`)))
  .catch((err) => {
    console.error('Failed to start:', err.message);
    process.exit(1);
  });
