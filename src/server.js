const express     = require('express');
const ATEM        = require('applest-atem');
const atemConfig  = require('./atemConfig.json');
const fs          = require('fs');
const SelfReloadJSON = require('self-reload-json');
const cors = require('cors')

const app = express();
var expressWs = require('express-ws')(app);

var config = new SelfReloadJSON('src/config.json');

let atem;
const switchers = [];

let preset ='';
let sceneAndCamera= true;

let CLIENTS = expressWs.getWss().clients;

let device = 0;
for (var switcher of atemConfig.switchers) {
  console.log('Initializing switcher', switcher.addr, switcher.port)
  atem = new ATEM;
  atem.event.setMaxListeners(5);
  atem.connect(switcher.addr, switcher.port);
  atem.state.device = device;
  switchers.push(atem);

  atem.on('stateChanged', (err, state) => {
    // console.log('atem stateChanged')
    broadcast(JSON.stringify(state));
  })
  atem.on('connect', (err) => {
    console.log('atem connected');
    broadcast(JSON.stringify({ method: 'connect', device: atem.device }));
  })
  atem.on('disconnect', (err) => {
    console.log('atem disconnected');
    broadcast(JSON.stringify({ method: 'disconnect', device: atem.device }));
  })
  device += 1;
}

function broadcast(message) {
  for (var client of CLIENTS) {
    client.send(message);
  }
}

app.use(cors());
app.use(express.json()) // for parsing application/json
app.use(express.urlencoded({ extended: true }))  // for parsing application/x-www-form-urlencoded
app.use(express.text())// for parsing application/plain-text

app.get('/config', function(request, response){
  console.log("Config wordt opgehaald");
  response.send(config);
});

app.get('/getPreset', function(request, response){
  console.log("Preset opgevraagd: " + preset);
  response.send(preset);
});

app.post('/savePreset', function(request, response){
  console.log("Preset gezet: " + request.body);
  preset = request.body;
  response.send("oke");
});

app.get('/getSceneAndCamera', function(request, response){
  console.log("SceneAndCamera opgevraagd: " + sceneAndCamera);
  response.send(sceneAndCamera);
});

app.post('/setSceneAndCamera', function(request, response){
  console.log("SceneAndCamera gezet: " + request.body);
  sceneAndCamera = request.body;
  response.send("oke");
});

app.ws('/atemWebSocket', function(ws, req) {
  const ip = req.connection.remoteAddress;
  console.log(ip, 'connected');
  // initialize client with all switchers
  for (var atem of switchers) {
    ws.send(JSON.stringify(atem.state));
  }

  ws.on('message', function incoming(message) {
    /* JSON-RPC v2 compatible call */
    console.log(message.slice(0, 500));
    const data = JSON.parse(message);
    const method = data.method;
    const params = data.params;
    const atem = switchers[params.device || 0];

    switch (method) {
      case 'changePreviewInput':
      case 'changeProgramInput':
        atem[method](params.input);
        break;
      case 'autoTransition':
      case 'cutTransition':
      case 'fadeToBlack':
        atem[method]();
        break;
      case 'changeUpstreamKeyState':
      case 'changeUpstreamKeyNextState':
        atem[method](params.number, params.state);
        break;
      case 'changeDownstreamKeyOn':
      case 'changeDownstreamKeyTie':
        atem[method](params.number, params.state);
        break;
      case 'changeTransitionPreview':
        atem[method](params.state, params.me);
        break;
      case 'changeTransitionPosition':
        atem[method](params.position);
        break;
      case 'changeTransitionType':
        atem[method](params.type);
        break;
      case 'changeUpstreamKeyNextBackground':
        atem[method](params.state);
        break;
      case 'autoDownstreamKey':
        atem[method](params.number);
        break;
      case 'runMacro':
        atem[method](params.number);
        break;
    }
  });
});

app.listen(atemConfig.server.port, atemConfig.server.host);
