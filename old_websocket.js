const net = require('net');
const crypto = require('crypto');
const async = require('async');

const PerMessageDeflate = require('./PerMessageDeflate');
const Extensions = require('./Extensions');
const bufferUtil = require('./BufferUtil');

const guid = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

class WsServer {
  constructor() {
    const that = this;

    this.maxFrameSize = 32768;
    this.frameOpCodes = {
      CONT: 0x00,
      TEXT: 0x01,
      BIN: 0x02,
      CTRL: 0x80
    };
    this.mask = {
      TO_SERVER: 0x80,
      TO_CLIENT: 0x00
    };
    this.fin = {
      CONT: 0x00,
      FIN: 0x80
    };

    this.options = {
      perMessageDeflate: {},
      maxPayload: 100 * 1024 * 1024
    };
    this.data = null;
    this.sockets = {};

    this.wsServer = net.createServer(function(socket) {
      let wsConnected = false;
      socket.on('close', function(err) {
        if (err) {
          console.error(err);
        }
      });
      socket.addListener('close', function(err) {
        console.log('there was error?');
        console.log(err);
      });
      socket.on('data', function(data, start, end) {
        //that.parse(data);
        that.processData(data, socket);
        if (!wsConnected) {
          var response = that.handleHandshake(data.toString('binary'), socket);
          if (response) {
            socket.write(response, 'binary');
            wsConnected = true;
          } else {
            // close connection, handshake bad
            console.log('close connection, handshake bad');
            socket.end();
            return;
          }
        }
      });
    });
    this.wsServer.listen(8080, "127.0.0.1");
  }

  decode(data, socket) {
    //console.log(data.length);
    //console.log(data[0] & 0x80);
    const result = {
      data: data,
      isMask: false,
      mask: null,
      binEncoding: false,
      nextFrame: null,
      opcode: null,
      compressed: false,
      payload: null,
      FIN: true
    };
    var opcode = result.opcode = (data[0] & 0x0F);
    var isFin = result.FIN = (data[0] & 0x80);
    var compressed = result.compressed = (data[0] & 0x40) === 0x40;
    var isMask = result.isMask = (data[1] & 0x80);
    result.isMask = !!result.isMask;

    var msgLength = (data[1] & 0x7f);
    var len = msgLength;
    var nextByte = 2;
    if (msgLength === 126) {
      // length = next 2 bytes
      len = data.readUInt16BE(2);
      nextByte += 2;
    } else if (msgLength === 127) {
      // length = next 8 bytes
      len = data.readUInt32BE(6);
      nextByte += 8;
    }
    result.dataLength = len;
    var maskingKey = null;
    if (isMask) {
      maskingKey = new Buffer(4);
      data.copy(maskingKey, 0, nextByte, nextByte + 4);
      nextByte += 4;
    }
    result.mask = maskingKey;
    var payload = new Buffer(len);
    data.copy(payload, 0, nextByte, (nextByte + len));

    if ((opcode >= 3 && opcode <= 7) || opcode > 10) {
      console.log('invalid code');
      return result;
    }

    if (maskingKey) {
      for (var i = 0; i < payload.length; i++) {
        payload[i] = payload[i] ^ maskingKey[i % 4];
      }
    }
    this.processFrame(result, payload, socket);
  }

  processData(frame, socket) {
    var result = this.decode(frame, socket);
  }

  decompressChain(payload, result, next) {

  }

  processFrame(result, payload, socket) {
    console.log(result);

    if(!result.FIN) {
      socket.compressedMsg = true;
    }
    const that = this;
      if(typeof socket.parts === 'undefined') {
        socket.parts = [];
        socket.partsLength = 0;
      }
      socket.partsLength++;
      const partsLength = socket.partsLength;
      if(result.compressed || socket.compressedMsg) {
        socket.parts.push(function(next) {
          that.decompress(payload, result.FIN, function(payload) {
            const fragment = that.handleFragment(result.FIN, result.opcode, payload, socket);
            socket.parts[partsLength-1] = payload;
            result.payload = fragment.payload;
            result.dataLength = fragment.dataLength;
            next(null);
          });
        });
      } else {
        socket.parts.push(function(next) {
          const fragment = that.handleFragment(result.FIN, result.opcode, payload, socket);
          socket.parts[partsLength-1] = payload;
          payload = fragment.payload;
          result.dataLength = fragment.dataLength;
          next(null);
        });
      }
      console.log('partsLength: '+partsLength);
    if(result.FIN) {
      async.series(socket.parts, function() {
        console.log(socket.parts);
        const msgLength = socket.parts.reduce(function (prev, curr) {
          console.log(curr.byteLength);
          prev += curr.length;
          return prev;
        }, 0);
        result.payload = toBuffer(socket.parts, msgLength);
        result.dataLength = msgLength;
        //console.log(socket.parts[2].toString());
        socket.compressedMsg = false;
        delete socket.parts;
        that.recvMsg(result);
      })
    }
  }

  recvMsg(result) {
    console.log(result);
    this.handleRecv(result);
  }

  handleRecv(data) {
    const that = this;
    const string = data.payload.toString();
    let frames;
    try {
      const json = JSON.parse(string);
      frames = this.createFrame("hello");
    } catch(e) {
      console.log('not a json');
      frames = this.createFrame(string);
    }
    frames.forEach(function (frame) {
      that.sendMessage(frame);
    })
  }

  /** Computes frame size on the wire from data to be sent
   *
   * @param {Buffer} data - data.length is the assumed payload size
   * @param {Boolean} mask - true if a mask will be sent (TO_SERVER)
   */
  frameSizeFromData(data, mask) {
    var headerSize = 10;
    if (data.length < 0x7E) {
      headerSize = 2;
    } else if (data.length < 0xFFFF) {
      headerSize = 4;
    }
    return headerSize + data.length + (mask ? 4 : 0);
  }

  createFrame(data) {
    console.log('################');
    /**
    *
    *  | Byte value                | 129          | 133                               | 32       | 25       | 208      | 9        | 72       | 124      | 188      | 101      | 79       |
    *  |-:-:-----------------------|-:-:----------|-:-:-------------------------------|----------|----------|----------|----------|----------|----------|----------|----------|----------|
    *  | **Binary representation** | 10000001     | 10000101                          | 00100000 | 00011001 | 11010000 | 00001001 | 01001000 | 01111100 | 10111100 | 01100101 | 01001111 |
    *  | **Meaning**               | Fin + opcode | Mask indicator + Length indicator | Key      | Key      | Key      | Key      | Content  | Content  | Content  | Content  | Content  |
    *
    */
    const opts = {
      binary: typeof data !== 'string',
      mask: false,
      compress: true,
      fin: true,
      readOnly: false
    };
    opts.opcode = opts.binary ? 2 : 1;
    if (!Buffer.isBuffer(data)) {
      if (data instanceof ArrayBuffer) {
        data = Buffer.from(data);
      } else if (ArrayBuffer.isView(data)) {
        data = viewToBuffer(data);
      } else {
        data = Buffer.from(data);
        opts.readOnly = false;
      }
    }
    console.log(data);
    const merge = data.byteLength < 1024 || (opts.mask && opts.readOnly);;
    var offset = opts.mask ? 6 : 2;
    var payloadLength = data.byteLength;

    if (data.length >= 65536) {
      offset += 8;
      payloadLength = 127;
    } else if (data.length > 125) {
      offset += 2;
      payloadLength = 126;
    }
    const target = Buffer.allocUnsafe(merge ? data.length + offset : offset);

    var opcode = 0;

    var length = payloadLength;


    target[0] = opts.fin ? opts.opcode | 0x80 : opts.opcode;
    if (opts.rsv1) target[0] |= 0x40;
    console.log('fin + opcode: '+target[0]);
    console.log(payloadLength);
    if (payloadLength === 126) {
      target.writeUInt16BE(data.length, 2, true);
    } else if (payloadLength === 127) {
      target.writeUInt32BE(0, 2, true);
      target.writeUInt32BE(data.length, 6, true);
    }

    if(!opts.mask) {
      target[1] = payloadLength;
      if(merge) {
        data.copy(target, offset);
        for(var i = 0; i < target.length; i++) {
          console.log(target[i]);
        }
        return [target];
      }
    }
    return [];

  }

  handleFragment(isFin, opcode, payload, socket) {
    console.log('will handle fragment');
    //socket.isFin = isFin;
    // console.log(payload.toString().substr(0, 100));
    var isBuffer = Buffer.isBuffer(payload);
    // console.log('is a buffer: ' + isBuffer);
    if ((opcode === 0 || opcode === 1 || opcode === 2)) {
      // console.log('will concatenate');
      if (typeof socket.bufferData === 'undefined') {
        // console.log('new buffer!');
        //socket.bufferData = new Buffer(payload.length);
        //payload.copy(socket.bufferData);
      } else {
        // console.log("buffer lengths: ");
        // console.log('socket.bufferData: ' + socket.bufferData.length);
        // console.log('payload: ' + payload.length);
        // console.log('combined: ' + (socket.bufferData.length + payload.length));
        //var buffer = new Buffer((socket.bufferData.length + payload.length));
        // console.log('buffer length: ' + buffer.length);
        //socket.bufferData.copy(buffer);
        //payload.copy(buffer, socket.bufferData.length);
        //socket.bufferData = buffer;

      }
      // console.log('length of final: ' + socket.bufferData.byteLength);
      // console.log('length of final (string): ' + socket.bufferData.toString().length);

    }
    if (isFin && (opcode === 0) && socket.bufferData) {
      //var buffer = new Buffer(socket.bufferData.length + payload.length);
      //socket.bufferData.copy(buffer);
      //payload.copy(buffer, socket.bufferData.length);

      //payload = buffer;

      //delete socket.bufferData;

    }
    return {
      payload: payload,
      dataLength: payload.byteLength
    };
  }

  /**
   * Decompresses data.
   *
   * @param {Buffer} data Compressed data
   * @private
   */
  decompress(data, fin, callback) {
    console.log('is compressing');
    const perMessageDeflate = this.extensions[PerMessageDeflate.extensionName];
    perMessageDeflate.decompress(data, fin, (err, buf) => {
      if (err) {
        // , err.closeCode === 1009 ? 1009 : 1007
        console.log(err);
        throw new Error('it errored');
        return callback("err");
      }
      console.log('finished decompressing');
      callback(buf);
    });
  }

  sendMessage(frame) {
    for(var i in this.sockets) {
      this.sockets[i].write(frame);
    }
  }

  handleHandshake(request, socket) {
    const headers = this.parseHeader(request);
    console.log(headers);
    const extensions = {};
    const perMessageDeflate = new PerMessageDeflate(
      this.options.perMessageDeflate,
      true,
      this.options.maxPayload
    );

    try {
      const offers = Extensions.parse(
        headers['Sec-WebSocket-Extensions']
      );

      if (offers[PerMessageDeflate.extensionName]) {
        perMessageDeflate.accept(offers[PerMessageDeflate.extensionName]);
        extensions[PerMessageDeflate.extensionName] = perMessageDeflate;
      }
    } catch (err) {
      console.log(err);
      return false; //abortConnection(socket, 400);
    }
    this.extensions = extensions;
    console.log(extensions);
    let headerExt = ['HTTP/1.1 101 Web Socket Protocol Handshake',
      'Upgrade: websocket',
      'Connection: Upgrade',
      'Access-Control-Allow-Credentials: true',
      'Access-Control-Allow-Headers: x-websocket-protocol',
      'Access-Control-Allow-Headers: x-websocket-version',
      'Access-Control-Allow-Headers: authorization',
      'Access-Control-Allow-Headers: content-type'
    ];
    if (extensions[PerMessageDeflate.extensionName]) {
      const params = extensions[PerMessageDeflate.extensionName].params;
      const value = Extensions.format({
        [PerMessageDeflate.extensionName]: [params]
      });
      headerExt.push(`Sec-WebSocket-Extensions: ${value}`);
    }
    console.log(headerExt);

    if ('Sec-WebSocket-Key' in headers) {
      var sha1 = crypto.createHash('sha1');
      sha1.update(headers['Sec-WebSocket-Key'] + guid);
      var acceptKey = sha1.digest('base64');
      //    var response = 'HTTP/1.1 101 Switching Protocols\r\n' +
      headerExt = headerExt.concat(['Sec-WebSocket-Accept: ' + acceptKey,
        'Sec-WebSocket-Origin: ' + headers['Origin'],
        'Date: ' + new Date().toString()
      ]);
      var response = headerExt.join('\r\n') + '\r\n\r\n';
      console.log(response);
      socket.id = acceptKey;
      this.sockets[socket.id] = socket;
      return response;
    }
    return false;

  }

  parseHeader(lines) {
    return lines.split('\r\n').reduce((prev, curr) => {
      const field = curr.split(':')[0];
      const value = curr.substr(field.length + 2);
      prev[field] = value;
      return prev;
    }, {});
  }
}

/**
 * Makes a buffer from a list of fragments.
 *
 * @param {Buffer[]} fragments The list of fragments composing the message
 * @param {Number} messageLength The length of the message
 * @return {Buffer}
 * @private
 */
function toBuffer (fragments, messageLength) {
  if (fragments.length === 1) return fragments[0];
  if (fragments.length > 1) return bufferUtil.concat(fragments, messageLength);
  return constants.EMPTY_BUFFER;
}

const server = new WsServer();
