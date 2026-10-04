import fs from 'node:fs';
import path from 'node:path';

export function androidJavaHome() {
  if(process.env.JAVA_HOME && fs.existsSync(path.join(process.env.JAVA_HOME,'bin/javac.exe'))) return process.env.JAVA_HOME;
  const jdks=path.join(process.env.USERPROFILE || '', '.jdks');
  if(fs.existsSync(jdks)) {
    const folders=fs.readdirSync(jdks).sort((a,b)=>Number(b.includes('21'))-Number(a.includes('21')));
    for(const name of folders) { const home=path.join(jdks,name);if(fs.existsSync(path.join(home,'bin/javac.exe')))return home; }
  }
  throw new Error('请设置 JAVA_HOME，指向 JDK 21（需要 java、javac、jar 和 keytool）');
}
