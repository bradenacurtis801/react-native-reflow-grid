module.exports = function (api) {
  api.cache(true);
  // Reanimated 4's babel plugin lives in react-native-worklets.
  return { presets: ['babel-preset-expo'], plugins: ['react-native-worklets/plugin'] };
};
