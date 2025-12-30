#!/usr/bin/env node
/**
 * Syncs version from package.json to plugin JSON files.
 * Run automatically via npm version hook.
 */

const fs = require('fs');
const path = require('path');

const { version } = require('../package.json');

const files = [
  '.claude-plugin/marketplace.json',
  'plugin/.claude-plugin/plugin.json',
];

for (const file of files) {
  const filePath = path.join(__dirname, '..', file);
  if (!fs.existsSync(filePath)) {
    console.warn(`Skipping ${file} (not found)`);
    continue;
  }

  const json = JSON.parse(fs.readFileSync(filePath, 'utf8'));

  // Update version at root level
  if (json.version) {
    json.version = version;
  }

  // Update version in plugins array (marketplace.json)
  if (json.plugins) {
    for (const plugin of json.plugins) {
      if (plugin.version) {
        plugin.version = version;
      }
    }
  }

  fs.writeFileSync(filePath, JSON.stringify(json, null, 2) + '\n');
  console.log(`Updated ${file} to v${version}`);
}
