import { execSync } from 'child_process';
import path from 'path';

function getShannonEntropy(str) {
  const len = str.length;
  if (len === 0) return 0;
  const frequencies = {};
  for (const char of str) {
    frequencies[char] = (frequencies[char] || 0) + 1;
  }
  let entropy = 0;
  for (const count of Object.values(frequencies)) {
    const p = count / len;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

function isEnvFile(filePath) {
  const normalized = filePath.replace(/\\/g, '/');
  const basename = path.basename(normalized);
  if (basename === '.env.example' || basename.endsWith('.example')) {
    return false;
  }
  return basename === '.env' || basename.startsWith('.env.') || basename.endsWith('.env') || basename.includes('.env.');
}

const KNOWN_PLACEHOLDERS = [
  'change_me',
  'placeholder',
  'localhost',
  'example',
  'postgres://',
  'http://',
  'https://',
  'your_',
  'my_local_dev_secret_123',
];

function isLikelySecret(token) {
  if (KNOWN_PLACEHOLDERS.some((p) => token.toLowerCase().includes(p))) {
    return false;
  }

  // Detect private keys
  if (token.includes('PRIVATE KEY')) {
    return true;
  }

  // Detect AWS keys
  if (/AKIA[0-9A-Z]{16}/.test(token)) {
    return true;
  }

  // Detect JWT-like tokens
  if (/ey[A-Za-z0-9_-]{15,}\.ey[A-Za-z0-9_-]{15,}/.test(token)) {
    return true;
  }

  // Detect generic secret/password assignment with long string
  const secretAssignMatch = /(?:secret|password|api[_-]?key|token|auth|credential)\s*[:=]\s*['"]([^'"]{16,})['"]/i.exec(token);
  if (secretAssignMatch) {
    const val = secretAssignMatch[1];
    if (!KNOWN_PLACEHOLDERS.some((p) => val.toLowerCase().includes(p))) {
      return true;
    }
  }

  // Detect long random-looking high-entropy tokens (e.g. 28+ chars, entropy > 3.7)
  const candidateWords = token.match(/[A-Za-z0-9+/=_-]{28,}/g) || [];
  for (const candidate of candidateWords) {
    // Skip if it looks like a git commit hash (40 hex chars) or UUID
    if (/^[0-9a-f]{40}$/i.test(candidate) || /^[0-9a-fA-F-]{36}$/.test(candidate)) {
      continue;
    }
    // Check entropy
    if (getShannonEntropy(candidate) > 3.7 && /[A-Z]/.test(candidate) && /[a-z]/.test(candidate) && /[0-9]/.test(candidate)) {
      return true;
    }
  }

  return false;
}

export function checkSecrets() {
  const issues = [];

  let stagedFilesOutput = '';
  try {
    stagedFilesOutput = execSync('git diff --cached --name-only', { encoding: 'utf-8' }).trim();
  } catch (err) {
    console.warn('Warning: Unable to inspect git staged files (not a git repo or git missing):', err.message);
    return { ok: true, issues: [] };
  }

  if (!stagedFilesOutput) {
    console.log('No staged files detected.');
    return { ok: true, issues: [] };
  }

  const stagedFiles = stagedFilesOutput.split(/\r?\n/).filter(Boolean);

  // 1. Check for staged .env files
  for (const file of stagedFiles) {
    if (isEnvFile(file)) {
      issues.push(`Staged .env file detected: ${file}`);
    }
  }

  // 2. Check staged diffs for long random-looking secrets or credentials
  let stagedDiff = '';
  try {
    stagedDiff = execSync('git diff --cached -U0', { encoding: 'utf-8' });
  } catch (err) {
    console.warn('Warning: Unable to inspect git diff:', err.message);
  }

  if (stagedDiff) {
    const diffLines = stagedDiff.split(/\r?\n/);
    let currentFile = '';

    for (const line of diffLines) {
      if (line.startsWith('+++ b/')) {
        currentFile = line.slice(6);
        continue;
      }
      // Skip lockfiles and documentation
      if (currentFile.endsWith('package-lock.json') || currentFile.endsWith('.lock') || currentFile.endsWith('.md')) {
        continue;
      }
      // Only examine added lines (starting with + but not +++)
      if (line.startsWith('+') && !line.startsWith('+++')) {
        const addedContent = line.slice(1).trim();
        if (isLikelySecret(addedContent)) {
          issues.push(`Potential secret detected in staged file ${currentFile}: "${addedContent.slice(0, 60)}..."`);
        }
      }
    }
  }

  if (issues.length > 0) {
    console.error('\n❌ check:secrets failed: Staged .env or sensitive secrets detected:');
    issues.forEach((issue) => console.error(`  - ${issue}`));
    console.error('\nPlease unstage or remove sensitive data before committing.\n');
    return { ok: false, issues };
  }

  console.log('✅ check:secrets passed: No staged .env or secret patterns found.');
  return { ok: true, issues: [] };
}

// Run directly when called via node
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))) {
  const result = checkSecrets();
  if (!result.ok) {
    process.exit(1);
  }
}
