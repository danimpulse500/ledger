// Seed script: creates the first admin user (and optionally sample data).
// Usage: npm run seed
const readline = require('readline');
const bcrypt = require('bcryptjs');
const db = require('./index');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((resolve) => rl.question(q, resolve));

(async () => {
  console.log('=== Invoicing App: Create Admin User ===');

  const existing = db.prepare('SELECT COUNT(*) AS c FROM users').get();
  if (existing.c > 0) {
    console.log(`There are already ${existing.c} user(s) in the database.`);
    const proceed = await ask('Create another user anyway? (y/N): ');
    if (proceed.toLowerCase() !== 'y') {
      rl.close();
      process.exit(0);
    }
  }

  const name = await ask('Admin name: ');
  const email = await ask('Admin email: ');
  const password = await ask('Admin password (min 8 chars): ');

  if (!name || !email || !password || password.length < 8) {
    console.log('Invalid input. Name, email, and an 8+ char password are required.');
    rl.close();
    process.exit(1);
  }

  const hash = bcrypt.hashSync(password, 10);
  try {
    db.prepare(`INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, 'admin')`)
      .run(name, email.toLowerCase().trim(), hash);
    console.log(`\nAdmin user "${name}" <${email}> created successfully.`);
  } catch (err) {
    console.error('Error creating user:', err.message);
  }

  rl.close();
  process.exit(0);
})();
