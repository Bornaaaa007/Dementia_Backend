import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { toNodeHandler } from 'better-auth/node';
import connectDB from './config/db.js';
import { auth } from './lib/auth.js';
import { warmUp } from './lib/face.js';
import { startScheduler } from './lib/escalation.js';
import { makeRequireAuth } from './middleware/requireAuth.js';
import { withPatient } from './middleware/patientAccess.js';
import patientRoutes from './routes/patients.js';
import faceRoutes from './routes/face.js';
import settingsRoutes from './routes/settings.js';
import deviceRoutes from './routes/device.js';
import memoryRoutes from './routes/memories.js';
import messageRoutes from './routes/messages.js';
import scheduleRoutes from './routes/schedules.js'; // Week 8
// Week 7 — family-side only (patient-side routes live inside device.js)
import { jukeboxRouter } from './routes/jukebox.js';
import { galleryRouter } from './routes/gallery.js';

const app = express();
const requireAuth = makeRequireAuth(auth);

const origins = (process.env.CORS_ORIGINS || '').split(',').filter(Boolean);
app.use(origins.length ? cors({ origin: origins, credentials: true }) : cors());

app.all('/api/auth/*splat', toNodeHandler(auth));

const faceJson = express.json({ limit: '8mb' });
app.use((req, res, next) => (req.path.includes('/face') ? faceJson(req, res, next) : next()));
app.use(express.json({ limit: '3mb' }));

app.get('/', (req, res) => res.json({ status: 'NestCare API running' }));
app.get('/api/me', requireAuth, (req, res) => res.json({ user: req.user }));

// Family / caregiver routes
app.use('/api/patients/:id/face',      requireAuth, withPatient('owner'), faceRoutes);
app.use('/api/patients/:id/memories',  requireAuth, memoryRoutes);
app.use('/api/patients/:id/messages',  requireAuth, messageRoutes);
app.use('/api/patients/:id/jukebox',   requireAuth, jukeboxRouter);   // Week 7
app.use('/api/patients/:id/gallery',   requireAuth, galleryRouter);   // Week 7
app.use('/api/patients/:id/schedules', requireAuth, withPatient(), scheduleRoutes); // Week 8
app.use('/api/patients',               requireAuth, patientRoutes);
app.use('/patients',                   requireAuth, patientRoutes);
app.use('/api/settings',               requireAuth, settingsRoutes);

// Patient device — one router handles everything under /api/patient-device
app.use('/api/patient-device', deviceRoutes);

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
      warmUp().catch((err) => console.warn('[face] not ready:', err.message));
      startScheduler(); // Week 8: generates reminders, marks missed doses, raises alerts
    })
  )
  .catch((err) => {
    console.error('Failed to start:', err.message);
    process.exit(1);
  });