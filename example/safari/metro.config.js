const { getDefaultConfig } = require('expo/metro-config');

module.exports = require('../metro.shared')(__dirname, getDefaultConfig);
