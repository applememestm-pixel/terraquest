import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const web = resolve(root, 'dist');
const assets = resolve(root, 'offline-assets');
const buildRoot = resolve(root, 'build');
const finalDirectory = resolve(buildRoot, 'mobile-web');
mkdirSync(buildRoot, { recursive: true });
if (realpathSync(buildRoot) !== resolve(realpathSync(root), 'build')) throw new Error('Build directory is redirected');
const destination = mkdtempSync(resolve(buildRoot, 'mobile-web-stage-'));
const manifest = JSON.parse(readFileSync(resolve(assets, 'manifest.json'), 'utf8'));
const world = JSON.parse(readFileSync(resolve(web, 'world.js'), 'utf8').trim().slice('const WORLD = '.length, -1));
const photos = JSON.parse(readFileSync(resolve(web, 'country-photos.js'), 'utf8').trim().slice('const COUNTRY_PHOTOS = '.length, -1));

function asset(key) {
  const file = manifest[key];
  if (typeof file !== 'string' || !/^(arms|photos)\/[a-z0-9-]+\.(png|jpg|webp|svg)$/.test(file)) {
    throw new Error('Offline asset missing: ' + key);
  }
  const from = resolve(assets, file);
  const to = resolve(destination, 'local', file);
  if (!existsSync(from)) throw new Error('Offline asset not on disk: ' + file);
  mkdirSync(dirname(to), { recursive: true });
  cpSync(from, to);
  return 'local/' + file;
}

mkdirSync(destination, { recursive: true });
for (const file of ['app.js','atlases.js','catalog.js','country-info.js','d3-array.min.js','d3-geo.min.js','flags','game-progress.js','icons','mobile.js','style.css','theme.js']) {
  cpSync(resolve(web, file), resolve(destination, file), { recursive: true });
}
for (const country of world.countries) {
  country.armsSources = [asset('arms/' + country.id.toLowerCase())];
  const gallery = photos[country.id];
  if (!gallery?.length) throw new Error('Photo gallery missing: ' + country.id);
  photos[country.id] = gallery.flatMap((photo, index) => {
    const key = 'photos/' + country.id.toLowerCase() + '-' + (index + 1);
    return manifest[key] ? [{ src: asset(key), label: photo.label, author: photo.author, license: photo.license }] : [];
  });
  if (!photos[country.id].length) throw new Error('Offline gallery missing: ' + country.id);
}

const html = readFileSync(resolve(web,'index.html'),'utf8')
  .replace('<head>', '<head>\n  <meta http-equiv="Content-Security-Policy" content="default-src \'self\' file:; script-src \'self\' file:; style-src \'self\' file:; img-src \'self\' file: data:; connect-src \'none\'; object-src \'none\'; form-action \'none\'">')
  .replace('<script src="theme.js"></script>', '<script src="offline-mode.js"></script>\n  <script src="theme.js"></script>')
  .replace(/^.*(?:src="account\.js"|rel="manifest").*\r?\n/gm, '')
  .replace(/<a([^>]*?)href="https?:\/\/[^"]*"([^>]*)>(.*?)<\/a>/g, '<span$1>$3</span>');

writeFileSync(resolve(destination,'index.html'),html,'utf8');
writeFileSync(resolve(destination,'offline-mode.js'),'globalThis.TERRA_OFFLINE = true;\n','utf8');
writeFileSync(resolve(destination,'world.js'),'const WORLD = ' + JSON.stringify(world) + ';\n','utf8');
writeFileSync(resolve(destination,'country-photos.js'),'const COUNTRY_PHOTOS = ' + JSON.stringify(photos) + ';\n','utf8');
if (existsSync(finalDirectory)) {
  const finalStat = lstatSync(finalDirectory);
  if (!finalStat.isDirectory() || finalStat.isSymbolicLink() || realpathSync(finalDirectory) !== finalDirectory) {
    throw new Error('Offline build target is redirected');
  }
  rmSync(finalDirectory, { recursive: true });
}
renameSync(destination, finalDirectory);
console.log('Complete offline game: ' + finalDirectory);
