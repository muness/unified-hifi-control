#!/usr/bin/env node

/**
 * Build native installers (DMG for macOS, MSI for Windows, deb/rpm for Linux)
 *
 * Usage: npm run build:installers
 *
 * Prerequisites: Run npm run build:binaries first
 *
 * Platform-specific requirements:
 *   - macOS: pkgbuild, productbuild, hdiutil (built-in Xcode tools)
 *   - Windows: WiX Toolset v3 (wixtoolset.org)
 *   - Linux: fpm (gem install fpm)
 */

const { execSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const BINARIES = path.join(DIST, 'bin');
const INSTALLERS = path.join(DIST, 'installers');
const BUILD = path.join(ROOT, 'build');
const PKG_JSON = require(path.join(ROOT, 'package.json'));

const VERSION = PKG_JSON.version;
const APP_NAME = 'Unified Hi-Fi Control';
const APP_ID = 'com.cloudatlas.unified-hifi-control';

async function main() {
  console.log(`\n${'='.repeat(50)}`);
  console.log(`Building installers for ${APP_NAME} v${VERSION}`);
  console.log(`${'='.repeat(50)}\n`);

  fs.mkdirSync(INSTALLERS, { recursive: true });

  const platform = os.platform();
  const results = [];

  // Build for current platform
  if (platform === 'darwin') {
    results.push(await buildMacOS());
  } else if (platform === 'win32') {
    results.push(await buildWindows());
  } else if (platform === 'linux') {
    results.push(...await buildLinux());
  }

  // Summary
  console.log(`\n${'='.repeat(50)}`);
  console.log('Build Summary');
  console.log(`${'='.repeat(50)}`);

  for (const result of results) {
    const status = result.success ? '✓' : '✗';
    const size = result.size ? ` (${result.size})` : '';
    console.log(`${status} ${result.name}${size}`);
    if (!result.success && result.error) {
      console.log(`  Error: ${result.error}`);
    }
  }

  console.log(`\nOutput: ${INSTALLERS}`);
}

async function buildMacOS() {
  console.log('Building macOS installer (DMG)...\n');

  const result = { name: 'macOS DMG', success: false };

  // Check for both architectures
  const binaryArm = path.join(BINARIES, 'unified-hifi-macos-arm64');
  const binaryIntel = path.join(BINARIES, 'unified-hifi-macos-x64');

  // Use ARM64 if available, otherwise Intel
  let binary = fs.existsSync(binaryArm) ? binaryArm : binaryIntel;

  if (!fs.existsSync(binary)) {
    result.error = 'No macOS binary found. Run npm run build:binaries first.';
    console.error(result.error);
    return result;
  }

  try {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'uhc-macos-'));
    const pkgRoot = path.join(tempDir, 'root');
    const scriptsDir = path.join(BUILD, 'macos', 'scripts');
    const resourcesDir = path.join(BUILD, 'macos', 'resources');

    // Create package root structure
    fs.mkdirSync(path.join(pkgRoot, 'usr', 'local', 'bin'), { recursive: true });
    fs.mkdirSync(path.join(pkgRoot, 'Library', 'LaunchDaemons'), { recursive: true });

    // Copy binary
    fs.copyFileSync(binary, path.join(pkgRoot, 'usr', 'local', 'bin', 'unified-hifi-control'));
    fs.chmodSync(path.join(pkgRoot, 'usr', 'local', 'bin', 'unified-hifi-control'), 0o755);

    // Copy LaunchDaemon plist
    fs.copyFileSync(
      path.join(BUILD, 'macos', 'com.cloudatlas.unified-hifi-control.plist'),
      path.join(pkgRoot, 'Library', 'LaunchDaemons', 'com.cloudatlas.unified-hifi-control.plist')
    );

    // Build component package
    const componentPkg = path.join(tempDir, 'unified-hifi-control.pkg');
    console.log('Creating component package...');

    execSync(`pkgbuild \
      --root "${pkgRoot}" \
      --scripts "${scriptsDir}" \
      --identifier "${APP_ID}" \
      --version "${VERSION}" \
      --install-location "/" \
      "${componentPkg}"`, { stdio: 'inherit' });

    // Update distribution.xml with version
    let distXml = fs.readFileSync(path.join(BUILD, 'macos', 'distribution.xml'), 'utf8');
    distXml = distXml.replace('VERSION_PLACEHOLDER', VERSION);
    const distXmlPath = path.join(tempDir, 'distribution.xml');
    fs.writeFileSync(distXmlPath, distXml);

    // Build product package
    const productPkg = path.join(tempDir, 'product.pkg');
    console.log('Creating product package...');

    execSync(`productbuild \
      --distribution "${distXmlPath}" \
      --resources "${resourcesDir}" \
      --package-path "${tempDir}" \
      "${productPkg}"`, { stdio: 'inherit' });

    // Create DMG
    const dmgPath = path.join(INSTALLERS, `unified-hifi-control-${VERSION}.dmg`);
    const dmgTemp = path.join(tempDir, 'dmg');
    fs.mkdirSync(dmgTemp);

    // Copy pkg and uninstall script to DMG contents
    fs.copyFileSync(productPkg, path.join(dmgTemp, `Unified Hi-Fi Control ${VERSION}.pkg`));
    fs.copyFileSync(
      path.join(BUILD, 'macos', 'uninstall.sh'),
      path.join(dmgTemp, 'Uninstall.command')
    );
    fs.chmodSync(path.join(dmgTemp, 'Uninstall.command'), 0o755);

    console.log('Creating DMG...');
    execSync(`hdiutil create \
      -volname "Unified Hi-Fi Control" \
      -srcfolder "${dmgTemp}" \
      -ov \
      -format UDZO \
      "${dmgPath}"`, { stdio: 'inherit' });

    // Cleanup
    fs.rmSync(tempDir, { recursive: true });

    const stats = fs.statSync(dmgPath);
    result.success = true;
    result.size = `${(stats.size / 1024 / 1024).toFixed(1)} MB`;
    result.path = dmgPath;

    console.log(`\n✓ Created: ${dmgPath}`);

  } catch (err) {
    result.error = err.message;
    console.error('macOS build failed:', err.message);
  }

  return result;
}

async function buildWindows() {
  console.log('Building Windows installer (MSI)...\n');

  const result = { name: 'Windows MSI', success: false };

  const binary = path.join(BINARIES, 'unified-hifi-win-x64.exe');
  if (!fs.existsSync(binary)) {
    result.error = 'Windows binary not found. Run npm run build:binaries first.';
    console.error(result.error);
    return result;
  }

  // Check for WiX
  const wixPaths = [
    process.env.WIX ? path.join(process.env.WIX, 'bin') : null,
    'C:\\Program Files (x86)\\WiX Toolset v3.11\\bin',
    'C:\\Program Files (x86)\\WiX Toolset v3.14\\bin',
  ].filter(Boolean);

  let wixBin = null;
  for (const p of wixPaths) {
    if (fs.existsSync(path.join(p, 'candle.exe'))) {
      wixBin = p;
      break;
    }
  }

  if (!wixBin) {
    result.error = 'WiX Toolset not found. Install from https://wixtoolset.org/';
    console.error(result.error);
    console.log('\nAlternatively, run on Windows with WiX installed:');
    console.log(`  powershell -File build\\windows\\build.ps1 -Version ${VERSION} -BinaryPath "${binary}"`);
    return result;
  }

  try {
    const wxsFile = path.join(BUILD, 'windows', 'installer.wxs');
    const wixobjFile = path.join(INSTALLERS, 'installer.wixobj');
    const msiFile = path.join(INSTALLERS, `unified-hifi-control-${VERSION}.msi`);

    console.log('Compiling WiX source...');
    execSync(`"${path.join(wixBin, 'candle.exe')}" \
      -dVersion=${VERSION} \
      -dBinaryPath="${binary}" \
      -ext WixUtilExtension \
      -out "${wixobjFile}" \
      "${wxsFile}"`, { stdio: 'inherit' });

    console.log('Linking MSI...');
    execSync(`"${path.join(wixBin, 'light.exe')}" \
      -ext WixUIExtension \
      -ext WixUtilExtension \
      -cultures:en-us \
      -out "${msiFile}" \
      "${wixobjFile}"`, { stdio: 'inherit' });

    // Cleanup
    fs.unlinkSync(wixobjFile);

    const stats = fs.statSync(msiFile);
    result.success = true;
    result.size = `${(stats.size / 1024 / 1024).toFixed(1)} MB`;
    result.path = msiFile;

    console.log(`\n✓ Created: ${msiFile}`);

  } catch (err) {
    result.error = err.message;
    console.error('Windows build failed:', err.message);
  }

  return result;
}

async function buildLinux() {
  console.log('Building Linux packages (deb, rpm)...\n');

  const results = [];

  // Check for binaries
  const binaryX64 = path.join(BINARIES, 'unified-hifi-linux-x64');
  const binaryArm64 = path.join(BINARIES, 'unified-hifi-linux-arm64');

  if (!fs.existsSync(binaryX64) && !fs.existsSync(binaryArm64)) {
    const result = { name: 'Linux packages', success: false, error: 'No Linux binary found' };
    console.error(result.error);
    return [result];
  }

  // Check for fpm
  try {
    execSync('which fpm', { stdio: 'ignore' });
  } catch {
    const result = { name: 'Linux packages', success: false, error: 'fpm not found. Install: gem install fpm' };
    console.error(result.error);
    return [result];
  }

  const archs = [];
  if (fs.existsSync(binaryX64)) archs.push({ binary: binaryX64, arch: 'amd64', rpmArch: 'x86_64' });
  if (fs.existsSync(binaryArm64)) archs.push({ binary: binaryArm64, arch: 'arm64', rpmArch: 'aarch64' });

  for (const { binary, arch, rpmArch } of archs) {
    // Build .deb
    const debResult = await buildLinuxPackage(binary, arch, 'deb');
    results.push(debResult);

    // Build .rpm
    const rpmResult = await buildLinuxPackage(binary, rpmArch, 'rpm');
    results.push(rpmResult);
  }

  return results;
}

async function buildLinuxPackage(binary, arch, format) {
  const result = { name: `Linux ${format} (${arch})`, success: false };

  try {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `uhc-linux-${format}-`));

    // Create directory structure
    fs.mkdirSync(path.join(tempDir, 'usr', 'local', 'bin'), { recursive: true });
    fs.mkdirSync(path.join(tempDir, 'lib', 'systemd', 'system'), { recursive: true });
    fs.mkdirSync(path.join(tempDir, 'var', 'lib', 'unified-hifi-control'), { recursive: true });

    // Copy binary
    fs.copyFileSync(binary, path.join(tempDir, 'usr', 'local', 'bin', 'unified-hifi-control'));
    fs.chmodSync(path.join(tempDir, 'usr', 'local', 'bin', 'unified-hifi-control'), 0o755);

    // Copy systemd service
    fs.copyFileSync(
      path.join(BUILD, 'linux', 'unified-hifi-control.service'),
      path.join(tempDir, 'lib', 'systemd', 'system', 'unified-hifi-control.service')
    );

    const outputName = `unified-hifi-control_${VERSION}_${arch}.${format}`;
    const outputPath = path.join(INSTALLERS, outputName);

    console.log(`Creating ${outputName}...`);

    execSync(`fpm \
      -s dir \
      -t ${format} \
      -n unified-hifi-control \
      -v ${VERSION} \
      -a ${arch} \
      --description "Source-agnostic hi-fi control bridge" \
      --url "https://github.com/cloud-atlas-ai/unified-hifi-control" \
      --maintainer "Muness Castle <muness@alrubaie.net>" \
      --license "ISC" \
      --after-install /dev/stdin \
      -p "${outputPath}" \
      -C "${tempDir}" \
      .`, {
      stdio: ['pipe', 'inherit', 'inherit'],
      input: `#!/bin/bash
systemctl daemon-reload
systemctl enable unified-hifi-control
systemctl start unified-hifi-control
echo "Unified Hi-Fi Control installed. Web UI: http://localhost:8088"
`
    });

    // Cleanup
    fs.rmSync(tempDir, { recursive: true });

    const stats = fs.statSync(outputPath);
    result.success = true;
    result.size = `${(stats.size / 1024 / 1024).toFixed(1)} MB`;
    result.path = outputPath;

    console.log(`  ✓ ${outputName}`);

  } catch (err) {
    result.error = err.message;
    console.error(`  ✗ ${result.name}: ${err.message}`);
  }

  return result;
}

main().catch((err) => {
  console.error('Build failed:', err);
  process.exit(1);
});
