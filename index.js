import constants from './constants';
import Extensions from'./Extensions';
import PerMessageDeflate = from'./PerMessageDeflate';

let extensions;


const getInfo = (data) => {

  var FIN = (data[0] & 0x80);
  var RSV1 = (data[0] & 0x40);
  var RSV2 = (data[0] & 0x20);
  var RSV3 = (data[0] & 0x10);
  var Opcode = data[0] & 0x0F;
  const compressed = (data.slice(2)[0] & 0x40) === 0x40;
  var mask = (data[1] & 0x80) === 0x80;
  const length = (data[1] & 0x7F);
  let payloadLength = length;

  let nextByte = 2;
  if (length === 126) {
    // length = next 2 bytes
    const size = 2;
    const buf = data.slice(nextByte, nextByte + size);
    payloadLength = buf.readUInt16BE(0);
    nextByte += size;
  } else if (length === 127) {
    // length = next 8 bytes
    const size = 8;
    const buf = data.slice(nextByte, nextByte + size);
    const num = buf.readUInt32BE(0);
    //
    // The maximum safe integer in JavaScript is 2^53 - 1. An error is returned
    // if payload length is greater than this number.
    //
    debug({num});
    if (num > Math.pow(2, 53 - 32) - 1) {
    /*
      return error(
        RangeError,
        'Unsupported WebSocket frame: payload length > 2^53 - 1',
        false,
        1009
      );*/
      console.error('error');
    }
    payloadLength = num * Math.pow(2, 32) + buf.readUInt32BE(4);
    nextByte += size;
  }

  let maskingKey = null;
  if (mask) {
    maskingKey = data.slice(nextByte, nextByte + 4);
    nextByte += 4;
  }
  return {
    FIN,
    RSV1,
    RSV2,
    RSV3,
    Opcode,
    mask,
    length,
    maskingKey,
    payloadLength,
    compressed,
    data: data.slice(nextByte, nextByte + payloadLength),
  };
};


function concatBuffer (list, totalLength) {
  const target = Buffer.allocUnsafe(totalLength);
  var offset = 0;

  for (var i = 0; i < list.length; i++) {
    const buf = list[i];
    buf.copy(target, offset);
    offset += buf.length;
  }

  return target;
}

const unmask = (mask, buffer) => {
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

const parse = function(data, socket) {
  /**
   *
   *   0                   1                   2                   3
   *   0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
   *  +-+-+-+-+-------+-+-------------+-------------------------------+
   *  |F|R|R|R| opcode|M| Payload len |    Extended payload length    |
   *  |I|S|S|S|  (4)  |A|     (7)     |             (16/64)           |
   *  |N|V|V|V|       |S|             |   (if payload len==126/127)   |
   *  | |1|2|3|       |K|             |                               |
   *  +-+-+-+-+-------+-+-------------+ - - - - - - - - - - - - - - - +
   *  |     Extended payload length continued, if payload len == 127  |
   *  + - - - - - - - - - - - - - - - +-------------------------------+
   *  |                               |Masking-key, if MASK set to 1  |
   *  +-------------------------------+-------------------------------+
   *  | Masking-key (continued)       |          Payload Data         |
   *  +-------------------------------- - - - - - - - - - - - - - - - +
   *  :                     Payload Data continued ...                :
   *  + - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - +
   *  |                     Payload Data continued ...                |
   *  +---------------------------------------------------------------+
   *
   */
  /*
  console.log('final: ', final);
  try {
    const json = JSON.parse(final);
    if (json.getConnections) {
      console.log(wsServer.getConnections(function(err, count) {
        console.log('count: ' + count);
      }));
    }
  } catch (e) {
    console.log('no other data');
  }
*/
  const info = getInfo(data);
  debug({...info, data: null});
  let payload = info.data;
  if (info.FIN) {
    console.log('### FINAL');
  }
  if (info.mask) {
    payload = unmask(info.maskingKey, payload);
  }
  const { Opcode } = info;
  const processData = (payload, index, FIN) => {

    let final;
    if ([0, 1].includes(Opcode)) {
      this.messageLength = this.messageLength || 0;
      this.messageLength += info.payloadLength;
      if (Opcode !== 0 && !this.payload) {
        this.payload[index] = payload;
      }
      if (Opcode === 0 && this.payload) {
        console.log('concatnating buffers');
        this.payload[index] = payload;
      // addToBuffer(this.payload, payload, (this.payload.length || 0) + payload.length);
      }
    }
    console.log('messageLength: ', this.messageLength);
    if (FIN && [0, 1, 2].includes(Opcode) && this.payload) {
      console.log('bufferSize: ', this.payload.length);
      final = concatBuffer(this.payload, this.messageLength).toString();
      delete this.payload;
      this.messageLength = 0;
      console.log('final', final);
    }
  };

  if ([0, 1, 2].includes(Opcode)) {
    if (Opcode === 1 && !this.payload) {
      this.payload = [payload];
    } else {
      this.payload.push(payload);
    }
  }
  const index = this.payload ? this.payload.length : 0;
  if (info.compressed && extensions) {
    return extensions[PerMessageDeflate.extensionName].decompress(payload, info.FIN, function(err, buffer) {
      console.log('done decompressing');
      processData(payload, index, info.FIN);
    });
  }
  processData(payload, index, info.FIN);
};

function acceptExtensions(offer) {
  var extensions = {};
  var options = true;
  if (options && offer[PerMessageDeflate.extensionName]) {
    var perMessageDeflate = new PerMessageDeflate(options !== true ? options : {}, true);
    perMessageDeflate.accept(offer[PerMessageDeflate.extensionName]);
    extensions[PerMessageDeflate.extensionName] = perMessageDeflate;
  }
  return extensions;
}

