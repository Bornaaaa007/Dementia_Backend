import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { toNodeHandler } from 'better-auth/node';
import connectDB from './config/db.js';
import { auth } from './lib/auth.js';
import { warmUp } from './lib/face.js';
import { makeRequireAuth } from './middleware/requireAuth.js';
import { withPatient } from './middleware/patientAccess.js';
import patientRoutes from './routes/patients.js';
import faceRoutes from './routes/face.js';
import settingsRoutes from './routes/settings.js';
import deviceRoutes from './routes/device.js';
import memoryRoutes from './routes/memories.js';

const app = express();
const requireAuth = makeRequireAuth(auth);

const origins = (process.env.CORS_ORIGINS || '').split(',').filter(Boolean);
app.use(origins.length ? cors({ origin: origins, credentials: true }) : cors());

// Better Auth handler MUST come before express.json()
app.all('/api/auth/*splat', toNodeHandler(auth));

// Face photos are bigger than profile pictures, so they get a higher limit.
// This must come before the global parser below.
const faceJson = express.json({ limit: '8mb' });
app.use((req, res, next) => (req.path.includes('/face') ? faceJson(req, res, next) : next()));
app.use(express.json({ limit: '3mb' })); // patient photos are sent as small base64 images

app.get('/', (req, res) => res.json({ status: 'NestCare API running' }));
app.get('/api/me', requireAuth, (req, res) => res.json({ user: req.user }));

// Family / caregiver accounts
app.use('/api/patients/:id/face', requireAuth, withPatient('owner'), faceRoutes); // before the general patients router
app.use('/api/patients/:id/memories', requireAuth, memoryRoutes);
app.use('/api/patients', requireAuth, patientRoutes);
app.use('/patients', requireAuth, patientRoutes); // same routes without /api, for older screens
app.use('/api/settings', requireAuth, settingsRoutes);

// Patient device (token from pairing + face check, no email/password)
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
  .then(() =>
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`Server on port ${PORT}`);
      // load the face models now so the first login isn't slow; a failure here doesn't stop the server
      warmUp().catch((err) => console.warn('[face] not ready:', err.message));
    })
  )
  .catch((err) => {
    console.error('Failed to start:', err.message);
    process.exit(1);
  });