// Windows installer settings. The names, the app id and the update address come from flavor.json, so a
// copy of the project (the lab) installs as a separate app next to this one.
const flavor = require('./flavor.json')

module.exports = {
  appId: `${flavor.appId}.desktop`,
  productName: flavor.desktopName,
  // The package name picks the install folder (Programs\<name>) and the update cache. Both copies had
  // "aniplayer", so the lab installed over the main app and each update replaced the other's files.
  extraMetadata: { name: flavor.dataFolder },
  protocols: [{ name: flavor.name, schemes: [flavor.scheme] }],
  publish: [{ provider: 'generic', url: `https://github.com/${flavor.repo}/releases/latest/download` }],
  directories: { output: 'release' },
  files: ['dist/**', 'electron/**', 'build/icon.png', 'package.json', 'flavor.json'],
  win: { target: [{ target: 'nsis', arch: ['x64'] }], icon: 'build/icon.png' },
  nsis: {
    oneClick: true,
    perMachine: false,
    createDesktopShortcut: true,
    shortcutName: flavor.desktopName,
    artifactName: `${flavor.desktopName.replace(/\s+/g, '-')}-Setup-\${version}.exe`,
  },
  npmRebuild: false,
}
