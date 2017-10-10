
const Stream = require('stream').Stream;
const Buffers = require('buffers');
const util = require('util');
const path = require('path');
const os = require('os');

const cv = module.exports = require('./bindings');

const PACKAGE_DIR = __dirname;
const Matrix = cv.Matrix;
const VideoCapture = cv.VideoCapture;
const VideoWriter = cv.VideoWriter;

Matrix.prototype.detectObject = function (classifier, opts, cb) {
  let face_cascade;
  opts = opts || {};
  cv._detectObjectClassifiers = cv._detectObjectClassifiers || {};

  if (!(face_cascade = cv._detectObjectClassifiers[classifier.path])) {
    face_cascade = new cv.CascadeClassifier(classifier.path);
    cv._detectObjectClassifiers[classifier.path] = face_cascade;
  }

  face_cascade.detectMultiScale(this, cb, opts.scale, opts.neighbors
          , opts.min && opts.min[0], opts.min && opts.min[1]);
};


Matrix.prototype.inspect = function () {
  const size = (this.size() || []).join('x');
  return "[ Matrix " + size + " ]";
};

// we use the Opencv constants naming convention to extract the number of bytes (8, 16, 32, 64), and the number of channels from constants names
const getNumberOfBytesAndChannelsPerType = function (type) {
  const regExp = /CV_([0-9]+)([A-Z]+)([0-9]+)/;
  for (let k in cv.Constants)
    if (cv.Constants.hasOwnProperty(k) && k.match(regExp) && cv.Constants[k] === type) {
      var bytes, channels, dataType;
      k.replace(regExp, function (all, b, l, c) {
        bytes = b;
        channels = c;
        dataType = l[0];
      });

      return {
        bytes: parseInt(bytes),
        channels: !isNaN(parseInt(channels)) && parseInt(channels),
        dataType: dataType,
        label: k
      };
    }
};

const getBufferMethodName = function (bytes, dataType, endianness, read) {
  let fnName = read ? "read" : "write";


  if (bytes === 32 && (dataType === "F" || dataType === "S")) {
    if (dataType === "F") {
      fnName += "Float" + endianness;
    } else {//dataType === "S"
      fnName += "Int32" + endianness;
    }
  } else if (bytes === 8) {
    fnName += (dataType === "U" ? "U" : "") + "Int8";
  } else if (bytes === 16) {
    fnName += (dataType === "U" ? "U" : "") + "Int16" + endianness;
  } else {
    throw("This matrix type (CV_" + bytes + dataType
            + ") is not compatible with fromArray/toArray");
  }

  return fnName;
};

Matrix.fromArray = function (arr, type) {


  const bytesAndChannels = getNumberOfBytesAndChannelsPerType(type);
  const bytes = bytesAndChannels.bytes;
  const channels = bytesAndChannels.channels ? bytesAndChannels.channels : 1;
  const dataType = bytesAndChannels.dataType;
  const label = bytesAndChannels.label;

  if (!Array.isArray(arr) || !Array.isArray(arr[0]) || !Array.isArray(arr[0][0])
          || (channels && arr[0][0].length !== channels)) {
    throw(new Error("Input array must be a 3-level array/matrix with size "
            + "rows x cols x channels corresponding to dataType (" + label + ")"));
  }

  const rows = arr.length;
  const cols = arr[0].length;

  const mat = new cv.Matrix(rows, cols, type);

  const n_bytes = bytes / 8;
  const buf = new Buffer(rows * cols * channels * n_bytes);

  buf.fill(0);

  const fnName = getBufferMethodName(bytes, dataType, os.endianness(), false);

  for (let i = 0; i < rows * cols * channels; i++) {
    const c = i % channels;
    const r = Math.floor(i / channels);
    const y = r % cols;
    const x = Math.floor(r / cols);
    buf[fnName](arr[x][y][c], i * n_bytes);
  }

  mat.put(buf);

  return mat;
};

Matrix.prototype.toArray = function () {
  const size = this.size();
  const buf = this.getData();
  const type = this.type();
  const bytesAndChannels = getNumberOfBytesAndChannelsPerType(type);
  const bytes = bytesAndChannels.bytes;
  const channels = bytesAndChannels.channels || this.channels();
  const dataType = bytesAndChannels.dataType;

  const n_bytes = bytes / 8;
  const fnName = getBufferMethodName(bytes, dataType, os.endianness(), true);

  const res = [];
  for (let i = 0; i < size[0]; i++) {
    const row = [];
    for (let j = 0; j < size[1]; j++) {
      const channelsValues = [];
      for (let k = 0; k < channels; k++) {
        const index = (i * size[1] + j) * channels + k;
        channelsValues.push(buf[fnName](index * n_bytes));
      }
      row.push(channelsValues);
    }
    res.push(row);
  }
  return res;
};

const ImageStream = cv.ImageStream = function () {
  this.writable = true;
};
util.inherits(ImageStream, Stream);


ImageStream.prototype.write = function (buf) {
  const self = this;
  cv.readImage(buf, function (err, matrix) {
    if (err)
      return self.emit('error', err);
    self.emit('data', matrix);
  });
};


const ImageDataStream = cv.ImageDataStream = function () {
  this.data = Buffers([]);
  this.writable = true;
};
util.inherits(ImageDataStream, Stream);


ImageDataStream.prototype.write = function (buf) {
  this.data.push(buf);
  return true;
};


ImageDataStream.prototype.end = function (b) {
  const self = this;
  if (b) {
    ImageStream.prototype.write.call(this, b);
  }

  const buf = this.data.toBuffer();
  cv.readImage(buf, function (err, im) {
    if (err) {
      return self.emit('error', err);
    }
    self.emit('load', im);
  });
};


const ObjectDetectionStream = cv.ObjectDetectionStream = function (cascade, opts) {
  this.classifier = new cv.CascadeClassifier(cascade);
  this.opts = opts || {};
  this.readable = true;
  this.writable = true;
};
util.inherits(ObjectDetectionStream, Stream);


ObjectDetectionStream.prototype.write = function (m) {
  const self = this;
  this.classifier.detectMultiScale(m,
          function (err, objs) {
            if (err) {
              return self.emit('error', err);
            }
            self.emit('data', objs, m);
          },
          this.opts.scale,
          this.opts.neighbors,
          (this.opts.min && this.opts.min[0]),
          (this.opts.min && this.opts.min[1]));
};


VideoStream = cv.VideoStream = function (src) {
  if (!(src instanceof VideoCapture)) {
    src = new VideoCapture(src);
  }
  this.video = src;
  this.readable = true;
  this.paused = false;
};
util.inherits(VideoStream, Stream);


VideoStream.prototype.read = function () {
  const self = this;
  const frame = function () {
    self.video.read(function (err, mat) {
      if (err) {
        return self.emit('error', err);
      }
      self.emit('data', mat);
      if (!self.paused) {
        process.nextTick(frame);
      }
    });
  };

  frame();
};


VideoStream.prototype.pause = function () {
  this.paused = true;
};
VideoStream.prototype.resume = function () {
  this.paused = false;
  this.read();
};
VideoCapture.prototype.toStream = function () {
  return new VideoStream(this);
};

const Cascade = {
  createCascade: function (name, fileName, filePath) {
    if (!filePath) {
      filePath = path.resolve(PACKAGE_DIR, '../data', fileName);
    }
    return {name: name, fileName: fileName, path: filePath};
  },
  init: function () {
    Cascade.FACE_CASCADE = Cascade.createCascade(
            "FACE_CASCADE", "haarcascade_frontalface_alt.xml");
    Cascade.EYE_CASCADE = Cascade.createCascade(
            "EYE_CASCADE", "haarcascade_eye.xml");
    Cascade.EYEGLASSES_CASCADE = Cascade.createCascade(
            "EYEGLASSES_CASCADE", "haarcascade_eye_tree_eyeglasses.xml");
    Cascade.FULLBODY_CASCADE = Cascade.createCascade(
            "FULLBODY_CASCADE", "haarcascade_fullbody.xml");
    Cascade.CAR_SIDE_CASCADE = Cascade.createCascade(
            "CAR_SIDE_CASCADE", "hogcascade_cars_sideview.xml");
  }
};
Cascade.init();
cv.Cascade = Cascade;

