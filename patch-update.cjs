const fs = require('fs');

let content = fs.readFileSync('src/main/updateService.js', 'utf8');

content = content.replace(
  /checksumUrl: release\.assets\?\.find\(a => a\.name === \(asset\?\.name \+ "\.sha256"\)\)\?\.browser_download_url \?\? null/g,
  'checksumUrl: asset ? (release.assets?.find(a => a.name === `${asset.name}.sha256`)?.browser_download_url ?? null) : null'
);

fs.writeFileSync('src/main/updateService.js', content);
