import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const native = resolve(root, 'native/android');
const work = resolve(root, 'build/android');
const web = resolve(root, 'build/mobile-web');
const suffix = process.platform === 'win32' ? '.exe' : '';
const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
const javaHome = process.env.JAVA_HOME;
const toolsRoot = sdk && join(sdk, 'build-tools');
const latestBuildTools = toolsRoot && existsSync(toolsRoot)
  ? readdirSync(toolsRoot).filter(name => /^\d+(\.\d+)+$/.test(name)).sort((a,b) => b.localeCompare(a,'en',{numeric:true}))[0]
  : null;
const tools = process.env.ANDROID_BUILD_TOOLS || (latestBuildTools && join(toolsRoot, latestBuildTools));
const androidJar = process.env.ANDROID_JAR || (sdk && join(sdk, 'platforms','android-35','android.jar'));
if (!tools || !androidJar || !existsSync(androidJar)) {
  throw new Error('Set ANDROID_HOME or ANDROID_BUILD_TOOLS and ANDROID_JAR (Android API 35).');
}

function run(program, args) {
  const result = spawnSync(program, args, { cwd: root, stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(program + ' failed (' + result.status + ')');
}
const jdk = name => javaHome ? join(javaHome,'bin',name+suffix) : name+suffix;
const sdkTool = name => join(tools,name+suffix);

run(process.execPath, [resolve(root,'scripts/build-offline.mjs')]);
for (const path of ['res/drawable','classes','dex']) mkdirSync(resolve(work,path),{recursive:true});
cpSync(resolve(web,'icons/terra-192.png'),resolve(work,'res/drawable/terra.png'));
const compiled = resolve(work,'resources.zip');
const unsigned = resolve(work,'terra-unsigned.apk');
const aligned = resolve(work,'terra-aligned.apk');
const apk = resolve(work,'Terra.apk');
const keystore = resolve(work,'terra-debug.jks');

run(sdkTool('aapt2'), ['compile','--dir',resolve(work,'res'),'-o',compiled]);
run(sdkTool('aapt2'), ['link','-o',unsigned,'-I',androidJar,'--manifest',resolve(native,'AndroidManifest.xml'),'-A',web,compiled]);
run(jdk('javac'), ['-encoding','UTF-8','--release','8','-classpath',androidJar,'-d',resolve(work,'classes'),resolve(native,'src/MainActivity.java')]);
const classesJar = resolve(work,'classes.jar');
run(jdk('jar'), ['--create','--file',classesJar,'-C',resolve(work,'classes'),'.']);
run(jdk('java'), ['-cp',join(tools,'lib','d8.jar'),'com.android.tools.r8.D8','--min-api','26','--lib',androidJar,'--output',resolve(work,'dex'),classesJar]);
run(jdk('jar'), ['--update','--file',unsigned,'--no-manifest','-C',resolve(work,'dex'),'classes.dex']);
run(sdkTool('zipalign'), ['-f','4',unsigned,aligned]);
if (!existsSync(keystore)) {
  run(jdk('keytool'), ['-genkeypair','-keystore',keystore,'-storepass','android','-keypass','android','-alias','terra-debug','-keyalg','RSA','-keysize','2048','-validity','10000','-dname','CN=Terra Debug']);
}
const signer = join(tools,'lib','apksigner.jar');
run(jdk('java'), ['-jar',signer,'sign','--ks',keystore,'--ks-pass','pass:android','--key-pass','pass:android','--out',apk,aligned]);
run(jdk('java'), ['-jar',signer,'verify','--verbose',apk]);
console.log(apk);
