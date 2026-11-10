import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const rootDirectory = path.resolve(scriptDirectory, '..');
const packagePath = path.join(rootDirectory, 'package.json');
const versionPath = path.join(rootDirectory, 'version.json');
const htmlPath = path.join(rootDirectory, 'index.html');
const readmePath = path.join(rootDirectory, 'README.md');
const input = process.argv[2];

if (!input) {
  console.error('Usage: node scripts/set-version.mjs <patch|minor|major|x.y.z>');
  process.exit(1);
}

const packageData = JSON.parse(await readFile(packagePath, 'utf8'));
const currentMatch = String(packageData.version).match(/^(\d+)\.(\d+)\.(\d+)$/);
if (!currentMatch) throw new Error(`Invalid current version: ${packageData.version}`);

const current = currentMatch.slice(1).map(Number);
let nextVersion;

if (['patch', 'minor', 'major'].includes(input)) {
  const [major, minor, patch] = current;
  if (input === 'major') nextVersion = `${major + 1}.0.0`;
  if (input === 'minor') nextVersion = `${major}.${minor + 1}.0`;
  if (input === 'patch') nextVersion = `${major}.${minor}.${patch + 1}`;
} else if (/^\d+\.\d+\.\d+$/.test(input)) {
  nextVersion = input;
} else {
  throw new Error(`Invalid version or bump type: ${input}`);
}

if (nextVersion === packageData.version) {
  throw new Error(`Version is already ${nextVersion}`);
}

packageData.version = nextVersion;
await writeFile(packagePath, `${JSON.stringify(packageData, null, 2)}\n`);

const releaseMetadata = {
  version: nextVersion,
  tag: `v${nextVersion}`,
  channel: 'stable',
  releasedAt: new Date().toISOString().slice(0, 10)
};
await writeFile(versionPath, `${JSON.stringify(releaseMetadata, null, 2)}\n`);

let html = await readFile(htmlPath, 'utf8');
html = html.replace(
  /<meta name="application-version" content="[^"]+">/,
  `<meta name="application-version" content="${nextVersion}">`
);
html = html.replace(
  /<span id="appVersion" class="app-version">v[^<]+<\/span>/,
  `<span id="appVersion" class="app-version">v${nextVersion}</span>`
);
await writeFile(htmlPath, html);

let readme = await readFile(readmePath, 'utf8');
readme = readme.replace(
  /<!-- app-version -->\s*\*\*Current stable version:\*\* `v[^`]+`/,
  `<!-- app-version -->\n**Current stable version:** \`v${nextVersion}\``
);
await writeFile(readmePath, readme);

console.log(`Version updated: ${current.join('.')} -> ${nextVersion}`);
console.log('Review and commit the changed version files before tagging or deploying.');
