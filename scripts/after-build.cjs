const { createHash } = require('node:crypto');
const { readFileSync, writeFileSync } = require('node:fs');
const path = require('node:path');

module.exports = async function afterAllArtifactBuild(context) {
  const checksumFiles = [];
  for (const file of context.artifactPaths) {
    if (!file.endsWith('.exe')) continue;
    const hash = createHash('sha256').update(readFileSync(file)).digest('hex');
    const out = file + '.sha256';
    writeFileSync(out, `${hash}  ${path.basename(file)}\n`);
    console.log(`[after-build] SHA-256: ${path.basename(out)}`);
    checksumFiles.push(out);
  }
  return checksumFiles;
};
