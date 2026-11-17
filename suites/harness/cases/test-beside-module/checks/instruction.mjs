import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
if (!existsSync('test/slugify.test.mjs')) process.exit(1);
execSync('node --test test/', { stdio: 'ignore' });
