import { betterAuth } from 'better-auth';
import { expo } from '@better-auth/expo';

export function createAuth(database) {
  return betterAuth({
    database,
    secret: process.env.BETTER_AUTH_SECRET,
    baseURL: process.env.BETTER_AUTH_URL || 'http://localhost:5000',
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      maxPasswordLength: 128,
      resetPasswordTokenExpiresIn: 60 * 30, // reset token valid for 30 minutes
      // No email service is connected yet, so the token is printed in this terminal.
      // Replace with nodemailer / Resend / SendGrid for production.
      sendResetPassword: async ({ user, token }) => {
        console.log(`\n[password reset] account: ${user.email}\n[password reset] token:   ${token}\n`);
      },
    },
    // Session expiry: 7 days, refreshed once a day while the app is used
    session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24 },
    plugins: [expo()],
    trustedOrigins: [
      'dementianestcare://',
      'dementianestcare://*',
      ...(process.env.CORS_ORIGINS || '').split(',').filter(Boolean),
      ...(process.env.NODE_ENV !== 'production' ? ['exp://**'] : []),
    ],
  });
}
