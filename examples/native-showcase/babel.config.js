const path = require('node:path')

module.exports = function (api) {
  api.cache(true)

  return {
    presets: [['babel-preset-expo', { transformImportMeta: true }]],
    plugins: [
      [
        '@foldkit/vite-plugin/babel',
        {
          brandModule: '@foldkit/native/brand',
          root: path.resolve(__dirname, '../..'),
        },
      ],
    ],
  }
}
