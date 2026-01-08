#!/usr/bin/env node

/**
 * Build standalone binaries for all platforms using pkg
 *
 * Usage: npm run build:binaries
 *
 * Output: dist/bin/
 *   - unified-hifi-linux-x64
 *   - unified-hifi-linux-arm64
 *   - unified-hifi-macos-x64
 *   - unified-hifi-macos-arm64
 *   - unified-hifi-win-x64.exe
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist', 'bin');
const PKG_JSON = require(path.join(ROOT, 'package.json'));

// Platform targets and output names
const TARGETS = [
  { target: 'node18-linux-x64', output: 'unified-hifi-linux-x64' },
  { target: 'node18-linux-arm64', output: 'unified-hifi-linux-arm64' },
  { target: 'node18-macos-x64', output: 'unified-hifi-macos-x64' },
  { target: 'node18-macos-arm64', output: 'unified-hifi-macos-arm64' },
  { target: 'node18-win-x64', output: 'unified-hifi-win-x64.exe' },
];

async function main() {
  console.log(`\nBuilding unified-hifi-control v${PKG_JSON.version}\n`);

  // Create dist directory
  fs.mkdirSync(DIST, { recursive: true });

  // Check for native modules that need special handling
  checkNativeModules();

  // Build each target
  for (const { target, output } of TARGETS) {
    console.log(`Building ${output}...`);

    const outputPath = path.join(DIST, output);

    try {
      execSync(
        `npx pkg . --target ${target} --output "${outputPath}"`,
        {
          cwd: ROOT,
          stdio: 'inherit',
        }
      );
      console.log(`  ✓ ${output}\n`);
    } catch (error) {
      console.error(`  ✗ Failed to build ${output}\n`);
      process.exit(1);
    }
  }

  // Print summary
  console.log('\n=== Build Complete ===\n');
  console.log('Binaries:');
  for (const { output } of TARGETS) {
    const filePath = path.join(DIST, output);
    if (fs.existsSync(filePath)) {
      const stats = fs.statSync(filePath);
      const sizeMB = (stats.size / 1024 / 1024).toFixed(1);
      console.log(`  ${output} (${sizeMB} MB)`);
    }
  }
  console.log(`\nOutput directory: ${DIST}`);
}

function checkNativeModules() {
  // sharp is a native module - pkg bundles it but we need platform-specific builds
  // The @yao-pkg/pkg handles this automatically for common native modules
  console.log('Note: Native modules (sharp) will be bundled for each platform.\n');

  // For production, consider:
  // 1. Using sharp's prebuilt binaries (included automatically)
  // 2. Or replacing with a pure JS alternative for maximum compatibility
}

main().catch((err) => {
  console.error('Build failed:', err);
  process.exit(1);
});
