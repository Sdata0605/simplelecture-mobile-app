const { withGradleProperties } = require('@expo/config-plugins');

module.exports = function withTargetSdk(config) {
  return withGradleProperties(config, (config) => {
    config.modResults = config.modResults.filter(
      (item) =>
        item.key !== 'android.targetSdkVersion' &&
        item.key !== 'android.compileSdkVersion'
    );
    config.modResults.push({ type: 'property', key: 'android.targetSdkVersion', value: '35' });
    config.modResults.push({ type: 'property', key: 'android.compileSdkVersion', value: '35' });
    return config;
  });
};
