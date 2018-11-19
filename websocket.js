import net from 'net';
import { handleHandshake } from './http';
import PerMessageDeflate from'./PerMessageDeflate';
import Receiver from './receiver';

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
const wsServer = net.createServer(function(socket) {
  console.log(socket);
  let wsConnected = false;
  var receiver;
  socket.addListener('data', function(data, start, end) {
    if (wsConnected) {
      receiver.parse(data);
      // parse(data, socket);
      console.log('socket id: ', socket.id);
      console.log('connected with ws');
    } else {
      var response = handleHandshake(data.toString('binary'), socket);
      if (response) {
        console.log('send resp');
        console.log(response.extOffers);
        const extensions = acceptExtensions(response.extOffers);
        receiver = new Receiver(extensions);
        socket.write(response.raw, 'binary');
        wsConnected = true;
      } else {
        console.log('close?');
        // close connection, handshake bad
        socket.end();
        return;
      }
    }
  });
});

wsServer.listen(1337, '127.0.0.1');
