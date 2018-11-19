import crypto from 'crypto';
import Extensions from'./Extensions';
import constants from './constants';
import { debug } from './utils';

const { guid } = constants;

export const parseHeader = function(lines) {
  return lines.split('\r\n').reduce((prev, curr) => {
    const field = curr.split(':')[0];
    const value = curr.substr(field.length + 2);
    prev[field] = value;
    return prev;
  }, {});
};
export const handleHandshake = function(request, socket) {
  const headers = parseHeader(request);
  debug(headers);
  if ('Sec-WebSocket-Key' in headers) {
    var sha1 = crypto.createHash('sha1');
    sha1.update(headers['Sec-WebSocket-Key'] + guid);
    var acceptKey = sha1.digest('base64');
    var response = {
      raw: 'HTTP/1.1 101 Web Socket Protocol Handshake\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      'Access-Control-Allow-Credentials: true\r\n' +
      'Access-Control-Allow-Headers: x-websocket-protocol' + '\r\n' +
      'Access-Control-Allow-Headers: x-websocket-version' + '\r\n' +
      'Access-Control-Allow-Headers: x-websocket-extensions' + '\r\n' +
      'Access-Control-Allow-Headers: authorization' + '\r\n' +
      'Access-Control-Allow-Headers: content-type' + '\r\n' +
      'Sec-WebSocket-Accept: ' + acceptKey + '\r\n' +
      'Sec-WebSocket-Origin: ' + headers['Origin'] + '\r\n' +
      'Date: ' + new Date().toString() + '\r\n\r\n',
      extOffers: Extensions.parse(headers['Sec-WebSocket-Extensions']),
    };
    socket.id = acceptKey;
    return response;
  }
  return false;

};
