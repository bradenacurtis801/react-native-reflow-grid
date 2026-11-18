const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const root = path.resolve(__dirname, '..');
const config = getDefaultConfig(__dirname);

// Use the library from the parent folder's source, so edits show up without a build.
config.watchFolders = [root];
config.resolver.extraNodeModules = {
  'react-native-reflow-grid': root,
  // One copy of each of these, the example's, even for the library's files.
  react: path.resolve(__dirname, 'node_modules/react'),
  'react-native': path.resolve(__dirname, 'node_modules/react-native'),
  'react-native-reanimated': path.resolve(__dirname, 'node_modules/react-native-reanimated'),
  'react-native-worklets': path.resolve(__dirname, 'node_modules/react-native-worklets'),
};
// The library's own node_modules (dev copies of the above) must not be bundled.
config.resolver.blockList = [new RegExp(`${root.replace(/[\\/]/g, '[\\\\/]')}[\\\\/]node_modules[\\\\/].*`)];

module.exports = config;
