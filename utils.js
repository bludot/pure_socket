import constants from './constants';

export const debug = (...args) => {
  if (!process.env.DEBUG) {
    return;
  }
  if (typeof args[0] === 'object') {
    Object.keys(args[0]).map(key => {
      return (key + ':                         ').slice(0, 20) + args[0][key];
    }).forEach(string => console.log(string)); // eslint-disable-line no-console
  }
};


export const error = (ErrorCtor, message, prefix, statusCode) => {
  const err = new ErrorCtor(
    prefix ? `Invalid WebSocket frame: ${message}` : message
  );

  Error.captureStackTrace(err, error);
  err[constants.kStatusCode] = statusCode;
  return err;
};

/**
 * Copy all properties from `props` onto `obj`.
 * @param {object} obj Object onto which properties should be copied.
 * @param {object} props Object from which to copy properties.
 * @returns {object}
 * @private
 */
export const extend = (obj, props) => {
  for (let i in props) obj[i] = props[i];
  return obj;
};


const mergeBuffer = (mergedBuffer, buffers) => {
  var offset = 0;
  for (var i = 0, l = buffers.length; i < l; ++i) {
    var buf = buffers[i];
    buf.copy(mergedBuffer, offset);
    offset += buf.length;
  }
};

export const concatBuffers = (buffers) => {
  var length = 0;
  for (var i = 0, l = buffers.length; i < l; ++i) length += buffers[i].length;
  var mergedBuffer = new Buffer(length);
  mergeBuffer(mergedBuffer, buffers);
  return mergedBuffer;
};

/*
export const concatBuffers = (list, totalLength) => {
  const target = Buffer.allocUnsafe(totalLength);
  var offset = 0;

  for (var i = 0; i < list.length; i++) {
    const buf = list[i];
    buf.copy(target, offset);
    offset += buf.length;
  }

  return target;
};
*/

export const unmask = (mask, buffer) => {
  const length = buffer.length;
  for (var i = 0; i < length; i++) {
    buffer[i] ^= mask[i & 3];
  }
  return buffer;
  /*
  if (mask) {
    for (var i = 0; i < payload.length; i++) {
      payload[i] = payload[i] ^ mask[i % 4];
    }
  }
  return payload;
  */
};
