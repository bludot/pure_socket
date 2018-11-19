import PerMessageDeflate from'./PerMessageDeflate';
import { error, debug, extend, unmask, concatBuffers } from './utils';

const Receiver = function (extensions) {
  if (this instanceof Receiver === false) {
    throw new TypeError('Classes can\'t be function-called');
  }
  this.extensions = extensions;
  
  // constructor
  this.fragments = [];
  this.currentMessage = [];
  this.messageHandlers = [];
  this.ontext = (data) => {
    console.log(data.split('\n').length);
    console.log(data.split('').length);
    console.log(data.split('\n').slice(-100));
    console.log('messageHandlers: ', this.messageHandlers.length);
  };
};


extend(Receiver.prototype, {

  getInfo(data) {

    var FIN = (data[0] & 0x80);
    var RSV1 = (data[0] & 0x40);
    var RSV2 = (data[0] & 0x20);
    var RSV3 = (data[0] & 0x10);
    var opcode = data[0] & 0x0F;
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
        return error(
          RangeError,
          'Unsupported WebSocket frame: payload length > 2^53 - 1',
          false,
          1009
        );
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
      opcode,
      mask,
      length,
      maskingKey,
      payloadLength,
      compressed,
      data: data.slice(nextByte, nextByte + payloadLength),
    };
  },

  applyExtension(dataPack, callback) {
    if (dataPack.compressed) {
      return this.extensions[PerMessageDeflate.extensionName].decompress(dataPack.payload, dataPack.FIN, function(err, buffer) {
        console.log('done decompressing');
        return callback(null, { ...dataPack, payload: buffer });
      });
    }
    console.log('no compression, continue');
    return callback(null, { ...dataPack });
  },

  flush() {
    if (this.processing || this.dead) return;
    var handler = this.messageHandlers.shift();
    if (!handler) return;

    this.processing = true;
    var self = this;

    handler(function() {
      self.processing = false;
      self.flush();
    });
  },

  handleMessage(dataPack) {

    this.messageHandlers.push((callback) => {
      this.applyExtension(dataPack, (err, bufferPack) => {
        const { payload: buffer } = bufferPack;
        console.log(buffer);
        console.log(bufferPack);
        if (buffer != null) this.currentMessage.push(buffer);
        console.log('messageHandlers: ', this.messageHandlers.length);
        console.log('currentMessage: ', this.currentMessage.length);

        if (bufferPack.FIN) {
          var messageBuffer = concatBuffers(this.currentMessage);
          this.currentMessage = [];
          /*
            if (!Validation.isValidUTF8(messageBuffer)) {
              self.error('invalid utf8 sequence', 1007);
              return;
            }*/

          this.ontext(messageBuffer.toString('utf8')); // , { masked: state.masked, buffer: messageBuffer});
        }
        callback();
      });
    });
    this.flush();
  },


  parse(data) { //, socket) {
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
    const info = this.getInfo(data);
    debug({...info, data: null});
    let { data: payload } = info;
    const { opcode, FIN, mask, compressed } = info;
    if (FIN) {
      console.log('### FINAL');
    }
    if (![0, 1, 2].includes(opcode)) return;
    if (mask) {
      payload = unmask(info.maskingKey, payload);
    }

    const dataPack = {
      payload: payload,
      FIN: FIN,
      compressed: compressed,
    };
    if ([0,1,2].includes(opcode)) {
      return this.handleMessage({ ...dataPack });
    }
    return true;

    /*
    const processData = (payload, index, FIN) => {

      let final;
      if ([0, 1].includes(opcode)) {
        this.messageLength = this.messageLength || 0;
        this.messageLength += info.payloadLength;
        if (opcode !== 0 && !this.payload) {
          this.payload[index] = payload;
        }
        if (opcode === 0 && this.payload) {
          console.log('concatnating buffers');
          this.payload[index] = payload;
        // addToBuffer(this.payload, payload, (this.payload.length || 0) + payload.length);
        }
      }
      console.log('messageLength: ', this.messageLength);
      if (FIN && [0, 1, 2].includes(opcode) && this.payload) {
        console.log('bufferSize: ', this.payload.length);
        final = concatBuffer(this.payload, this.messageLength).toString();
        delete this.payload;
        this.messageLength = 0;
        console.log('final', final);
      }
    };

    if ([0, 1, 2].includes(opcode)) {
      if (opcode === 1 && !this.payload) {
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
    */
  }
});

export default Receiver;
