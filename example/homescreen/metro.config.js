const { getDefaultConfig } = require('expo/metro-config');

// The Safari tile opens the Safari example itself, from the folder next door.
module.exports = require('../metro.shared')(__dirname, getDefaultConfig, { includes: ['safari'] });
