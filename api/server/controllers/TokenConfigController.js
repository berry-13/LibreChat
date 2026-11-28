const { createTokenConfigController, getGoogleBillingConfig } = require('@librechat/api');
const { getRequestModelsConfig } = require('~/server/controllers/ModelController');
const { getUserKey, getValueKey, getMultiplier, getCacheMultiplier } = require('~/models');

module.exports = createTokenConfigController({
  getRequestModelsConfig,
  googleBillingConfig: getGoogleBillingConfig(process.env, getUserKey),
  getValueKey,
  getMultiplier,
  getCacheMultiplier,
});
