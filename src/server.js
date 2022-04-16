const express     = require('express');
const ATEM        = require('applest-atem');
const atemConfig = require('./atemConfig.json');
const camConfig = require('./config.json');
const SelfReloadJSON = require('self-reload-json');
const cors = require('cors');
const http = require('http');
const HttpUtils = require('./httpUtils.js');
const fetch = require('node-fetch');

const winston = require('winston');

const DailyRotateFile = require('winston-daily-rotate-file');

var transport = new DailyRotateFile({
  filename: 'server-%DATE%.log',
  datePattern: 'YYYY-MM-DD',
  zippedArchive: false,
  maxSize: '20m',
  maxFiles: '14d'
});


const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY/MM/DD HH:mm:ss' }),
    winston.format.printf(info => `[${info.timestamp}] ${info.level}: ${info.message}`)
  ),
  transports: [
    transport
  ],
});

//
// If we're not in production then log to the `console` with the format:
// `${info.level}: ${info.message} JSON.stringify({ ...rest }) `
//
if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.combine(
      winston.format.timestamp({ format: 'YYYY/MM/DD HH:mm:ss' }),
      winston.format.printf(info => `[${info.timestamp}] ${info.level}: ${info.message}`)
    ),
  }));
}


let httpUtils = new HttpUtils();

const app = express();
var expressWs = require('express-ws')(app);

var appConfig = new SelfReloadJSON('src/config.json');
logger.info(JSON.stringify(camConfig.cameras));
var cameras = camConfig.cameras;

const DeviceStatus = {
  statusFirst: 0x01,      // first boot
  statusRecord: 0x02,      // recording
  statusLiving: 0x04,      // live streaming
  statusStream: 0x08,      // Reserved
  statusDiskReady: 0x10,      // USB flash drive is ready to work
  statusRTMPReady: 0x20,      // RTMP is ready to live stream
  statusSoftAP: 0x40,      // The device is in Wi-Fi AP mode
  statusMIC: 0x100,     // Reserved
  statusPHONE: 0x200,     // Reserved
  statusOutput: 0x400,     // Reserved
  statusDiskTest: 0x1000,    // USB performance test is in progress
  statusBlue: 0x2000,    // Reserved
  statusUpgrade: 0x4000,    // Firmware update is in progress
  statusNetTest: 0x8000,    // Streaming test is in progress
  statusPasswd: 0x10000,   // Device password has been set
  statusOccupied: 0x20000,   // Device has been locked by app(s), at most 2 simultaneously
  statusFormatDisk: 0x100000,  // USB format is in progress
  statusSearchWifi: 0x400000,  // The device is searching for available Wi-Fi networks
  statusConnectWifi: 0x800000,  // The device is connecting to a Wi-Fi network
  statusConnectBlue: 0x1000000, // Reserved
  statusCheckUpgrade: 0x2000000, // The device is detecting if there is a new firmware version
  statusReset: 0x4000000,   // resetting
  stausIPv6: 0x8000000,   // Reserved
  statusTestLock: 0x10000000,  // Reserved
  statusReboot: 0x20000000,  // rebooting
}

let atem;
const switchers = [];

const deviceIP = '172.16.110.21';
const userName = 'Admin';
const password = 'e3afed0047b08059d0fada10f400c1e5';
let reqOpts = {};

const statusUrl = `http://${deviceIP}/usapi?method=get-status`;
const startStream = `http://${deviceIP}/usapi?method=start-live`;
const stopStream = `http://${deviceIP}/usapi?method=stop-live`;
const loginUrl = `http://${deviceIP}/usapi?method=login&id=${userName}&pass=${password}`;
const screenShotUrl = `http://${deviceIP}/tmp/sbox-snapshot/sbox-quarter.jpg?v=`;

let preset = '';
let uitzending = '';
let streamStatus = '';
let statusCameras = [];

let CLIENTS = expressWs.getWss().clients;

let device = 0;
for (var switcher of atemConfig.switchers) {
  logger.info('Initializing switcher', switcher.addr, switcher.port)
  atem = new ATEM;
  atem.event.setMaxListeners(5);
  atem.connect(switcher.addr, switcher.port);
  atem.state.device = device;
  switchers.push(atem);

  atem.on('stateChanged', (err, state) => {
    // logger.info('atem stateChanged')
    broadcast(JSON.stringify(state));
  })
  atem.on('connect', (err) => {
    logger.info('atem connected');
    broadcast(JSON.stringify({ method: 'connect', device: atem.device }));
  })
  atem.on('disconnect', (err) => {
    logger.info('atem disconnected');
    broadcast(JSON.stringify({ method: 'disconnect', device: atem.device }));
  })
  device += 1;
}

function broadcast(message) {
  for (var client of CLIENTS) {
    client.send(message);
  }
}

async function checkStatusCameras() {
  statusCameras = [];
  for (var cam of Object.keys(cameras)) {
    let camera = cameras[cam];
    await checkCameraStatus(camera);
  }
}

async function checkCameraStatus(camera) { 
  //logger.info("Check camera status: " + camera.naam);
  if (camera.ptz) {
    await httpUtils.get('http://' + camera.ip + '/powerModeInq')
      .then((result) => {
        let cameraStatus = JSON.parse(result['data']);
        logger.info("Camera: " + camera.naam + "Status: " + JSON.stringify(cameraStatus.POWERMODE));
        camera.status = cameraStatus.POWERMODE;
        statusCameras.push(camera);
      })
      .catch((err) => {
        logger.info('==> response data:');
        logger.error(err);
      });
  }
}

async function turnOffCameras() {
  let body = '{ "cmd": "campowerModeAction", "powermode": "0" }';
  for (var cam of Object.keys(cameras)) {
    let camera = cameras[cam];
    await checkCameraStatus(camera);
    // await loginCamera(camera);
    if (camera.status == "ON") {
      logger.info("Turn off camera: " + camera.naam);
      if (camera.ptz) {
        const options = {
          mode: 'no-cors',
          credentials: 'include',
          method: 'POST',
          referrerPolicy: "unsafe-url",
          headers: {
            "accept": "application/json, text/javascript, */*; q=0.01",
            "accept-language": "nl-NL,nl;q=0.9,en-US;q=0.8,en;q=0.7",
            "cache-control": "no-cache",
            "content-type": "application/json; charset=UTF-8",
            "pragma": "no-cache",
            "x-requested-with": "XMLHttpRequest",
            "Cookie": "Cookie: userName=" + camera.user + "; passWord=" + camera.password + ";"
          },
          body: body
        }

        await fetch('http://' + camera.ip + '/cgi-bin/lums_configuration.cgi', options)
          .then((result) => {
            response = JSON.stringify(result);
            logger.info(response);
          })
          .catch((err) => {
            logger.info('==> response data:');
            logger.error(err);
          });
      }
    }
    
  }
}

async function turnOnCameras() {
  let body = '{ "cmd": "campowerModeAction", "powermode": "1" }';
  for (var cam of Object.keys(cameras)) {
    let camera = cameras[cam];
    await checkCameraStatus(camera);
    // await loginCamera(camera);
    if (camera.status == "OFF") {
      logger.info("Turn on camera: " + camera.naam);
      if (camera.ptz) {
        const options = {
          mode: 'no-cors',
          credentials: 'include',
          method: 'POST',
          referrerPolicy: "unsafe-url",
          headers: {
            "accept": "application/json, text/javascript, */*; q=0.01",
            "accept-language": "nl-NL,nl;q=0.9,en-US;q=0.8,en;q=0.7",
            "cache-control": "no-cache",
            "content-type": "application/json; charset=UTF-8",
            "pragma": "no-cache",
            "x-requested-with": "XMLHttpRequest",
            "Cookie": "Cookie: userName=" + camera.user + "; passWord=" + camera.password + ";"
          },
          body: body
        }

        await fetch('http://' + camera.ip + '/cgi-bin/lums_configuration.cgi', options)
          .then((result) => {
            response = JSON.stringify(result);
            logger.info(response);
          })
          .catch((err) => {
            logger.info('==> response data:');
            logger.error(err);
          });
      }
    }

  }
}

function loadConfig() {
  appConfig = new SelfReloadJSON('src/config.json');
}

app.use(cors());
app.use(express.json()) // for parsing application/json
app.use(express.urlencoded({ extended: true }))  // for parsing application/x-www-form-urlencoded
app.use(express.text())// for parsing application/plain-text

app.get('/config', function(request, response){
  logger.info("Config wordt opgehaald");
  loadConfig();
  response.send(appConfig);
});

app.get('/camerasOff', async function (request, response) {
  await turnOffCameras();
  response.send(statusCameras);
});

app.get('/camerasOn', async function (request, response) {
  await turnOnCameras();
  response.send(statusCameras);
});

app.get('/loginStreamer', async function (request, response) {
  await checkStatusCameras();
  logger.info("Login to streamer");
  // login
  logger.info('==> 1. login');
  await httpUtils.get(loginUrl)
    .then((loginRes) => {
      // get Cookie info
      resCookies = loginRes['headers']['set-cookie'];
      logger.info('==> 2. get login cookie:');
      logger.info(resCookies);

      // set response Cookie
      reqOpts = {
        headers: {
          'Cookie': resCookies
        }
      }
      response.send("oke");
    })
    .catch(async (err) => {
      logger.info('==> response data:');
      logger.error(err);
      await turnOffCameras();
      response.status(400).end("error");
    });

})

app.get('/getCameraStatus', async function (request, response) {
  logger.info("Status cameras wordt opgevraagd.");
  await checkStatusCameras();
  response.send(statusCameras);
});


app.get('/streamStatus', async function (request, response) {
  httpUtils.get(statusUrl, reqOpts)
    .then((res) => {
      const data = res.data;
      logger.info(JSON.stringify(data["live-status"]));
      logger.info("Status stream:" + ((data["cur-status"] & DeviceStatus.statusLiving) == DeviceStatus.statusLiving));
      response.send(((data["cur-status"] & DeviceStatus.statusLiving) == DeviceStatus.statusLiving));
    })
    .catch(async (err) => {
      logger.error(err);
      await turnOffCameras();
      response.status(400).end("error");
  });
});

app.get('/streamData', function (request, response) {
  logger.info("Stream data wordt opgehaald");
  httpUtils.get(statusUrl, reqOpts)
    .then((res) => {
      const data = res.data;
      response.send(data["live-status"]);
    })
    .catch((err) => {
      logger.error(err);
      response.send("error");
  });
});

app.get('/stopStreamen', async function (request, response) {
  let status = '';
  await httpUtils.get(statusUrl, reqOpts)
    .then((res) => {
      status = res.data;
      //logger.info("Status stream in http :" + ((status["cur-status"] & DeviceStatus.statusLiving) == DeviceStatus.statusLiving));
    })
    .catch((err) => {
      logger.error(err);
      response.send("error");
    });
  logger.info("Streamen stoppen");
  httpUtils.get(stopStream, reqOpts);
  response.send("gestopt");
});

app.get('/startStreamen', async function (request, response) {
  let status = '';
  await httpUtils.get(statusUrl, reqOpts)
    .then((res) => {
      status = res.data;
      //logger.info("Status stream in http :" + ((status["cur-status"] & DeviceStatus.statusLiving) == DeviceStatus.statusLiving));
    })
    .catch((err) => {
      logger.error(err);
      response.send("error");
    });
  logger.info("Streamen starten");
  httpUtils.get(startStream, reqOpts);
  response.send("gestart");
});

app.get('/streamen', async function (request, response) {
  let status = '';
  await httpUtils.get(statusUrl, reqOpts)
    .then((res) => {
      status = res.data;
      //logger.info("Status stream in http :" + ((status["cur-status"] & DeviceStatus.statusLiving) == DeviceStatus.statusLiving));
    })
    .catch((err) => {
      logger.error(err);
      response.send("error");
    });

  logger.info("Status stream:" + ((status["cur-status"] & DeviceStatus.statusLiving) == DeviceStatus.statusLiving));
  if ((status["cur-status"] & DeviceStatus.statusLiving) == DeviceStatus.statusLiving) {
    logger.info("Streamen stoppen");
    httpUtils.get(stopStream, reqOpts);
    response.send("gestopt");
  } else {
    logger.info("Streamen starten");
    httpUtils.get(startStream, reqOpts);
    response.send("gestart");
  }
});

app.get('/screenshot.jpg', function (request, response) {
  let time = new Date().getTime();
  let data = '';


  http.request(screenShotUrl + time)
    .on('response', function (res) {

      var body = ''
      res.setEncoding('binary')
      res
        .on('error', function (err) {
          response.send(err)
        })
        .on('data', function (chunk) {
          body += chunk
        })
        .on('end', function () {
          response.contentType('image/jpeg');
          response.send(Buffer.from(body, 'binary'))
        })

    })
    .on('error', function (err) {
      response.send(err)
    })
    .end();
});

app.post('/saveStreamStatus', function (request, response) {
  logger.info("streamStatus wordt opgeslagen: " + request.body);
  streamStatuss = request.body;
  response.send("oke");
});

app.get('/getPreset', function(request, response){
  logger.info("Preset opgevraagd: " + preset);
  response.send(preset);
});

app.post('/savePreset', function(request, response){
  logger.info("Preset wordt opgeslagen: " + request.body);
  preset = request.body;
  response.send("oke");
});

app.get('/getUitzending', function (request, response) {
  logger.info("Uitzending opgevraagd: " + uitzending);
  if (uitzending == '') {
    uitzending = 'Kerkdienst';
  }
  response.send(uitzending);
});

app.post('/saveUitzending', function (request, response) {
  logger.info("Uitzending wordt opgeslagen: " + request.body);
  uitzending = request.body;
  response.send("oke");
});

app.ws('/atemWebSocket', function(ws, req) {
  const ip = req.connection.remoteAddress;
  logger.info(ip +' connected');
  // initialize client with all switchers
  for (var atem of switchers) {
    ws.send(JSON.stringify(atem.state));
  }

  ws.on('message', function incoming(message) {
    /* JSON-RPC v2 compatible call */
    logger.info(message.slice(0, 500));
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
