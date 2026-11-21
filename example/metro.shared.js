const fs = require('fs');
const path = require('path');

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Everything under a folder, whichever way the slashes go. */
const under = (folder) => new RegExp(`${folder.split(/[\\/]/).map(escapeRegExp).join('[\\\\/]')}[\\\\/].*`);

/**
 * The Metro config both example apps use: the library comes from the folder above `example/`, as source,
 * so an edit shows up without a build. `projectDir` is the app's own folder, and `getDefaultConfig` its `expo/metro-config`.
 */
module.exports = function metroConfig(projectDir, getDefaultConfig) {
  const root = path.resolve(projectDir, '..', '..');
  const examples = path.resolve(projectDir, '..');
  const config = getDefaultConfig(projectDir);

  config.watchFolders = [root];
  config.resolver.extraNodeModules = {
    'react-native-reflow-grid': root,
    // One copy of each of these, the app's, even for the library's files.
    react: path.resolve(projectDir, 'node_modules/react'),
    'react-native': path.resolve(projectDir, 'node_modules/react-native'),
    'react-native-reanimated': path.resolve(projectDir, 'node_modules/react-native-reanimated'),
    'react-native-worklets': path.resolve(projectDir, 'node_modules/react-native-worklets'),
    // The library asks for this one itself, and only if it's there (haptics): from its own folder it can't see the app's copy.
    'expo-haptics': path.resolve(projectDir, 'node_modules/expo-haptics'),
  };
  // Not bundled, and not watched: the library's own node_modules (dev copies of the above), and the other apps.
  const others = fs
    .readdirSync(examples, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && path.join(examples, entry.name) !== projectDir)
    .map((entry) => path.join(examples, entry.name));
  config.resolver.blockList = [root, ...others].map((folder) => under(folder === root ? path.join(root, 'node_modules') : folder));
  return config;
};
