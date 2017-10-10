const binary = require('node-pre-gyp');
const path = require('path');
const binding_path = binary.find(
        path.resolve(path.join(__dirname, '../package.json')),
        {debug: !!process.env.NODE_OPENCV_DEBUG}
);
const binding = require(binding_path);

//module.exports = require('../build/Release/opencv.node');
module.exports = binding;
