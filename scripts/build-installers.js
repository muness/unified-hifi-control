#!/usr/bin/env node

/**
 * Build native installers (DMG for macOS, MSI for Windows)
 *
 * Usage: npm run build:installers
 *
 * Prerequisites: Run npm run build:binaries first
 *
 * Output:
 *   - dist/unified-hifi-control-{version}.dmg (macOS)
 *   - dist/unified-hifi-control-{version}.msi (Windows)
 *   - dist/unified-hifi-control-{version}.deb (Debian/Ubuntu)
 *   - dist/unified-hifi-control-{version}.rpm (Fedora/RHEL)
 *
 * Platform-specific tools required:
 *   - macOS: pkgbuild, productbuild, hdiutil (built-in)
 *   - Windows: WiX Toolset (wixtoolset.org)
 *   - Linux: fpm (gem install fpm)
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const BINARIES = path.join(DIST, 'bin');
const INSTALLERS = path.join(DIST, 'installers');
const PKG_JSON = require(path.join(ROOT, 'package.json'));

const VERSION = PKG_JSON.version;
const APP_NAME = 'Unified Hi-Fi Control';
const APP_ID = 'com.cloudatlas.unified-hifi-control';

async function main() {
  console.log(`\nBuilding installers for ${APP_NAME} v${VERSION}\n`);

  fs.mkdirSync(INSTALLERS, { recursive: true });

  const platform = os.platform();

  if (platform === 'darwin') {
    await buildMacOS();
  } else if (platform === 'win32') {
    await buildWindows();
  } else if (platform === 'linux') {
    await buildLinux();
  } else {
    console.log(`Platform ${platform} not supported for installer builds`);
    console.log('Build installers on the target platform or use CI/CD');
  }
}

async function buildMacOS() {
  console.log('Building macOS installer...\n');

  const binary = path.join(BINARIES, 'unified-hifi-macos-arm64');
  if (!fs.existsSync(binary)) {
    console.error('macOS binary not found. Run npm run build:binaries first.');
    process.exit(1);
  }

  // TODO: Implement full macOS installer build
  // 1. Create .pkg with pkgbuild
  // 2. Create LaunchDaemon plist for auto-start
  // 3. Wrap in DMG with hdiutil
  // 4. Sign with codesign (requires Apple Developer cert)
  // 5. Notarize with notarytool (requires Apple Developer account)

  console.log('macOS installer build not yet implemented.');
  console.log('See docs/LMS-PLUGIN-SPEC.md for planned structure.');
  console.log('\nFor now, distribute via:');
  console.log('  - LMS plugin (npm run build:lms-plugin)');
  console.log('  - Standalone binary (dist/bin/unified-hifi-macos-*)');
}

async function buildWindows() {
  console.log('Building Windows installer...\n');

  const binary = path.join(BINARIES, 'unified-hifi-win-x64.exe');
  if (!fs.existsSync(binary)) {
    console.error('Windows binary not found. Run npm run build:binaries first.');
    process.exit(1);
  }

  // TODO: Implement full Windows MSI build
  // 1. Create WiX .wxs file (see build/windows/installer.wxs)
  // 2. Compile with candle.exe and light.exe
  // 3. Register as Windows Service (using node-windows or WiX ServiceInstall)
  // 4. Sign with signtool (requires code signing cert)

  console.log('Windows installer build not yet implemented.');
  console.log('See docs/LMS-PLUGIN-SPEC.md for planned structure.');
  console.log('\nFor now, distribute via:');
  console.log('  - LMS plugin (npm run build:lms-plugin)');
  console.log('  - Standalone binary (dist/bin/unified-hifi-win-x64.exe)');
}

async function buildLinux() {
  console.log('Building Linux packages...\n');

  const binary = path.join(BINARIES, 'unified-hifi-linux-x64');
  if (!fs.existsSync(binary)) {
    console.error('Linux binary not found. Run npm run build:binaries first.');
    process.exit(1);
  }

  // Check for fpm
  try {
    execSync('which fpm', { stdio: 'ignore' });
  } catch {
    console.error('fpm not found. Install with: gem install fpm');
    process.exit(1);
  }

  // TODO: Implement full Linux package build
  // 1. Create systemd service file
  // 2. Build .deb with fpm
  // 3. Build .rpm with fpm

  console.log('Linux package build not yet implemented.');
  console.log('See docs/LMS-PLUGIN-SPEC.md for planned structure.');
  console.log('\nFor now, distribute via:');
  console.log('  - LMS plugin (npm run build:lms-plugin)');
  console.log('  - Standalone binary (dist/bin/unified-hifi-linux-*)');
}

main().catch((err) => {
  console.error('Build failed:', err);
  process.exit(1);
});
