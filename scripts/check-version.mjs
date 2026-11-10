import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const rootDirectory = path.resolve(scriptDirectory, '..');
const read = (fileName) => readFile(path.join(rootDirectory, fileName), 'utf8');

const packageData = JSON.parse(await read('package.json'));
const versionData = JSON.parse(await read('version.json'));
const html = await read('index.html');
const readme = await read('README.md');
const version = packageData.version;

const checks = [
  [versionData.version === version, 'version.json version'],
  [versionData.tag === `v${version}`, 'version.json tag'],
  [html.includes(`<meta name="application-version" content="${version}">`), 'HTML version meta'],
  [html.includes(`<span id="appVersion" class="app-version">v${version}</span>`), 'footer version'],
  [readme.includes(`**Current stable version:** \`v${version}\``), 'README version']
];
const failed = checks.filter(([passed]) => !passed).map(([, label]) => label);

if (failed.length) {
  console.error(`Version metadata mismatch: ${failed.join(', ')}`);
  process.exit(1);
}

console.log(`Version metadata consistent: v${version}`);
