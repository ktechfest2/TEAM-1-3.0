/**
 * Creates an administrator account.
 *
 *   ADMIN_PASSWORD='a long passphrase' npm run admin:create -w @trustelect/api -- \
 *     --email you@example.org --name "Your Name" --role system_admin
 *
 * The password is read from ADMIN_PASSWORD so it never appears in shell history arguments.
 * Two-factor authentication is set up at first sign-in.
 */
import { parseArgs } from 'node:util';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module.js';
import { AuthService, type AdminRole } from '../auth/auth.service.js';

const ROLES: AdminRole[] = ['reviewer', 'declarations_admin', 'approver', 'system_admin'];

const { values } = parseArgs({
  options: {
    email: { type: 'string' },
    name: { type: 'string' },
    role: { type: 'string', default: 'reviewer' },
  },
});

const password = process.env.ADMIN_PASSWORD;
if (!values.email || !values.name || !password) {
  console.error('Usage: ADMIN_PASSWORD=... create-admin --email <email> --name <name> [--role <role>]');
  process.exit(1);
}
if (!ROLES.includes(values.role as AdminRole)) {
  console.error(`Role must be one of: ${ROLES.join(', ')}`);
  process.exit(1);
}

const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
try {
  const admin = await app.get(AuthService).createAdmin({
    email: values.email,
    displayName: values.name,
    role: values.role as AdminRole,
    password,
  });
  console.log(`Created ${values.role} ${admin.email}. Set up two-factor authentication at first sign-in.`);
} finally {
  await app.close();
}
