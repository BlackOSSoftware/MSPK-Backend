import mongoose from 'mongoose';

import config from '../config/config.js';
import connectDB from '../config/database.js';
import User from '../models/User.js';

const CONFIRM_TOKEN = 'CREATE_ADMIN_USER';

const hasFlag = (name) => process.argv.includes(`--${name}`);

const getArg = (name) => {
  const prefix = `--${name}=`;
  const byEquals = process.argv.find((arg) => arg.startsWith(prefix));
  if (byEquals) return byEquals.slice(prefix.length);

  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return null;
  return process.argv[index + 1] || null;
};

const sanitizeMongoUri = (value) => {
  if (!value) return '';
  return value.replace(
    /^(mongodb(?:\+srv)?:\/\/)([^@/]+@)(.+)$/i,
    (_, scheme, _creds, rest) => `${scheme}<redacted>@${rest}`
  );
};

const dryRun = hasFlag('dry-run') || hasFlag('dryrun');
const confirm = getArg('confirm');

const emailArg = getArg('email');
const passwordArg = getArg('password');
const nameArg = getArg('name') || 'Admin';

if (!emailArg || !passwordArg) {
  console.error('[CreateAdminUser] Missing required args: --email and --password');
  console.error(
    '[CreateAdminUser] Example: node src/scripts/createAdminUser.js --email admin@example.com --password <password> --confirm CREATE_ADMIN_USER'
  );
  process.exit(1);
}

if (!dryRun && confirm !== CONFIRM_TOKEN) {
  console.error('[CreateAdminUser] Refusing to run without explicit confirmation.');
  console.error(
    `[CreateAdminUser] Run: node src/scripts/createAdminUser.js --email ${emailArg} --password <password> --confirm ${CONFIRM_TOKEN}`
  );
  console.error('[CreateAdminUser] Tip: use --dry-run first to preview changes.');
  process.exit(1);
}

const run = async () => {
  console.log(`[CreateAdminUser] NODE_ENV=${config.env}`);
  console.log(`[CreateAdminUser] MONGO_URI=${sanitizeMongoUri(config?.mongoose?.url)}`);

  const email = String(emailArg || '').trim().toLowerCase();
  const password = String(passwordArg || '').trim();
  const name = String(nameArg || '').trim() || 'Admin';

  if (!email || !email.includes('@')) {
    throw new Error('Invalid email');
  }
  if (!password || password.length < 6) {
    throw new Error('Password must be at least 6 characters');
  }

  await connectDB();

  let user = await User.findOne({ email });
  const existed = Boolean(user);

  if (!user) {
    user = new User({
      name,
      email,
      password,
      role: 'admin',
      status: 'Active',
      isEmailVerified: true,
    });
  } else {
    user.role = 'admin';
    user.status = 'Active';
    user.isEmailVerified = true;
    if (!user.name) user.name = name;

    // Reset password and invalidate existing sessions.
    user.password = password;
    user.tokenVersion = (user.tokenVersion || 0) + 1;
    user.currentDeviceId = null;
  }

  if (dryRun) {
    console.log(`[CreateAdminUser] Dry run: would ${existed ? 'update' : 'create'} admin user ${email}`);
    return;
  }

  await user.save();

  console.log(
    `[CreateAdminUser] ${existed ? 'Updated' : 'Created'} admin user`,
    JSON.stringify(
      {
        id: user._id?.toString?.() || String(user._id),
        email: user.email,
        role: user.role,
        status: user.status,
        isEmailVerified: user.isEmailVerified,
      },
      null,
      2
    )
  );
};

try {
  await run();
  process.exit(0);
} catch (error) {
  console.error('[CreateAdminUser] Failed:', error?.message || error);
  process.exitCode = 1;
} finally {
  try {
    await mongoose.connection.close();
  } catch {
    // ignore
  }
}

