import mongoose from 'mongoose';
import Patient from '../models/Patient.js';

export const roleFor = (patient, userId) => {
  if (patient.createdBy === userId) return 'owner';
  if ((patient.members || []).includes(userId)) return 'member';
  return null;
};

// Loads :id and checks the logged-in user's role for that patient.
// need = 'member' (owner or member) or 'owner' (owner only)
export function withPatient(need = 'member') {
  return async (req, res, next) => {
    try {
      const id = req.params.id;
      if (!mongoose.isValidObjectId(id)) return res.status(400).json({ error: 'Invalid patient id' });
      const patient = await Patient.findById(id);
      if (!patient) return res.status(404).json({ error: 'Patient not found' });

      const role = roleFor(patient, req.user.id);
      if (!role) return res.status(403).json({ error: 'You do not have access to this patient' });
      if (need === 'owner' && role !== 'owner') {
        return res.status(403).json({ error: 'Only the profile owner can do this' });
      }
      req.patient = patient;
      req.patientRole = role;
      next();
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  };
}
