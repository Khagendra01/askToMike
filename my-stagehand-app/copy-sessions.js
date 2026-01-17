import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const sessionsDir = path.join(__dirname, '.sessions');
const sourceProfile = path.join(sessionsDir, 'linkedin-browser-profile');
const sourceSession = path.join(sessionsDir, 'linkedin-session.json');

// Profiles to create
const profiles = ['linkedin-comment', 'linkedin-explore', 'linkedin-reply'];

console.log('📋 Copying session to parallel profiles...\n');

// Check if source exists
if (!fs.existsSync(sourceProfile)) {
  console.error(`❌ Source profile not found: ${sourceProfile}`);
  process.exit(1);
}

if (!fs.existsSync(sourceSession)) {
  console.error(`❌ Source session file not found: ${sourceSession}`);
  process.exit(1);
}

// Read source session data
const sessionData = JSON.parse(fs.readFileSync(sourceSession, 'utf-8'));

// Function to copy directory recursively
function copyDir(src, dest) {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }

  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      // Skip lock files and logs that might cause issues
      if (entry.name.includes('LOCK') || 
          entry.name.includes('.log') || 
          entry.name.includes('chrome.pid') ||
          entry.name.includes('chrome-err.log') ||
          entry.name.includes('chrome-out.log')) {
        continue;
      }
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// Copy to each profile
for (const profileName of profiles) {
  const targetProfile = path.join(sessionsDir, `${profileName}-browser-profile`);
  const targetSession = path.join(sessionsDir, `${profileName}-session.json`);

  console.log(`📦 Copying to ${profileName}...`);

  // Copy browser profile directory
  if (fs.existsSync(targetProfile)) {
    console.log(`   ⚠️  Profile already exists, skipping directory copy...`);
  } else {
    console.log(`   📁 Copying browser profile...`);
    copyDir(sourceProfile, targetProfile);
    console.log(`   ✅ Browser profile copied`);
  }

  // Create session JSON file
  const newSessionData = {
    ...sessionData,
    userDataDir: targetProfile.replace(/\\/g, '/'), // Normalize path separators
  };
  fs.writeFileSync(targetSession, JSON.stringify(newSessionData, null, 2));
  console.log(`   ✅ Session file created: ${targetSession}`);

  console.log(`   ✅ ${profileName} ready!\n`);
}

console.log('🎉 All sessions copied successfully!');
console.log('\nYou can now run:');
console.log('  npm run linkedin-parallel');
console.log('  npm run linkedin-all');
console.log('  npm run linkedin-engagement');
console.log('  npm run linkedin-messaging');

