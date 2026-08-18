import {execFileSync} from 'node:child_process';
import {cp, mkdir, readdir, readFile, rm, stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = path.join(ROOT, 'extension');
const OUTPUT = path.join(ROOT, 'dist', 'socialedge-extension');

export const RELEASE_ALLOWLIST = Object.freeze([
  'manifest.json', 'background.js', 'popup.html', 'popup.js', 'popup.css',
  'PRIVACY_POLICY.md', 'Info Plan.pdf', 'lib', 'icons',
]);

const FORBIDDEN_NAMES = /(?:^|\/)(?:auth\.js|content(?:_main)?\.js|.*\.db(?:-wal|-shm)?|.*\.map|fixtures?|tests?|server)(?:\/|$)/i;
const FORBIDDEN_CONTENT = /(?:YOUR_GOOGLE_CLIENT_ID|http:\/\/localhost|JSESSIONID|chrome\.cookies)/;

async function filesUnder(directory, prefix = '') {
  const files = [];
  for (const name of await readdir(directory)) {
    const absolute = path.join(directory, name);
    const relative = path.join(prefix, name);
    if ((await stat(absolute)).isDirectory()) files.push(...await filesUnder(absolute, relative));
    else files.push(relative);
  }
  return files;
}

export async function auditRelease(directory = OUTPUT) {
  const files = await filesUnder(directory);
  for (const file of files) {
    if (FORBIDDEN_NAMES.test(file)) throw new Error(`Forbidden release file: ${file}`);
    if (/\.(?:js|json|html|md|css)$/i.test(file)) {
      const contents = await readFile(path.join(directory, file), 'utf8');
      if (FORBIDDEN_CONTENT.test(contents)) throw new Error(`Forbidden release content: ${file}`);
    }
  }
  return files.sort();
}

export async function packageExtension() {
  await rm(OUTPUT, {recursive: true, force: true});
  await mkdir(OUTPUT, {recursive: true});
  for (const entry of RELEASE_ALLOWLIST) {
    const source = path.join(SOURCE, entry);
    await cp(source, path.join(OUTPUT, entry), {recursive: true});
  }
  const files = await auditRelease(OUTPUT);
  process.stdout.write(`Packaged ${files.length} approved files in ${OUTPUT}\n`);
  return {directory: OUTPUT, files};
}

// Chrome Web Store submission requires a .zip of the package contents
// (a raw folder can't be uploaded); this is a separate step from
// packageExtension() because "Load unpacked" dev-mode testing only ever
// needs the folder, not an archive of it.
export async function buildZip(directory = OUTPUT) {
  const manifest = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8'));
  const zipPath = path.join(ROOT, 'dist', `socialedge-extension-v${manifest.version}.zip`);
  await rm(zipPath, {force: true});
  try {
    // -X drops extra file attributes (e.g. macOS resource forks) for a clean,
    // portable archive; contents are zipped from inside `directory` so paths
    // inside the zip are relative to the extension root, not to dist/.
    execFileSync('zip', ['-r', '-X', zipPath, '.'], {cwd: directory, stdio: 'pipe'});
  } catch (error) {
    throw new Error(`Failed to build zip (is the "zip" CLI installed?): ${error.message}`);
  }
  process.stdout.write(`Built ${zipPath}\n`);
  return zipPath;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await packageExtension();
  if (process.argv.includes('--zip')) await buildZip();
}
