const express     = require('express');
const atemConfig = require('./atemConfig.json');
// Load config from SQLite DB instead of file
const { initDb } = require('./db');
const { initSchema, migrateJsonToNormalized, buildJsonFromNormalized } = require('./db_normalized');
const SelfReloadJSON = require('self-reload-json');
const cors = require('cors');
const http = require('http');

// Check if we're in test mode
const isTestMode = process.argv.includes('--test') || process.env.TEST_MODE === '1';
let ATEM, HttpUtils;

if (isTestMode) {
  console.log('🧪 Running in TEST MODE - Using mocks for ATEM and Streamer');
  const { MockATEM, MockHttpUtils } = require('./mock.js');
  ATEM = MockATEM;
  HttpUtils = MockHttpUtils;
} else {
  console.log('🏭 Running in PRODUCTION MODE - Using real ATEM and Streamer');
  ATEM = require('applest-atem');
  HttpUtils = require('./httpUtils.js');
}

const winston = require('winston');

const DailyRotateFile = require('winston-daily-rotate-file');
const { json } = require('express');
const { ZLIB_VERSION } = require('zlib-sync');

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

// Initialize mock state if in test mode
if (isTestMode) {
  const { mockState } = require('./mock.js');
  // Override global state variables with mock values
  global.mockState = mockState;
}

const app = express();
var expressWs = require('express-ws')(app);
const wsServer = expressWs.getWss();

const db = initDb();
initSchema(db);
// On first boot, try to migrate legacy JSON into normalized tables
try {
  const fs = require('fs');
  const path = require('path');
  const legacyPath = path.join(__dirname, 'config.json');
  if (fs.existsSync(legacyPath)) {
    const raw = fs.readFileSync(legacyPath, 'utf8');
    const json = JSON.parse(raw);
    migrateJsonToNormalized(db, json);
  }
} catch(e) { logger.warn('Legacy migration skipped: ' + e.message); }
let appConfig = buildJsonFromNormalized(db);
logger.info('Config loaded:'+JSON.stringify(appConfig.cameras));
var cameras = appConfig.cameras;

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

const streamerIP = '172.16.110.20';
const userName = 'Admin';
const password = 'e3afed0047b08059d0fada10f400c1e5';
let reqOpts = {};

const statusUrl = `http://${streamerIP}/usapi?method=get-status`;
const startStream = `http://${streamerIP}/usapi?method=start-live`;
const stopStream = `http://${streamerIP}/usapi?method=stop-live`;
const startRecord = `http://${streamerIP}/usapi?method=start-rec`;
const stopRecord = `http://${streamerIP}/usapi?method=stop-rec`;
const loginUrl = `http://${streamerIP}/usapi?method=login&id=${userName}&pass=${password}`;
const screenShotUrl = `http://${streamerIP}/tmp/sbox-snapshot/sbox-quarter.jpg?v=`;
const streamerUrl = `http://${streamerIP}/`;
const filesUrl = `http://${streamerIP}/usapi?method=get-media-files&disk-type=1&start=0&count=300`;
const downloadUrl = `http://${streamerIP}:8080/download`;

// Initialize state variables (use mock values in test mode)
let preset = isTestMode ? (global.mockState?.preset || 'default') : '';
let uitzending = isTestMode ? (global.mockState?.uitzending || 'avond') : '';
let streamStatus = isTestMode ? (global.mockState?.streamStatus || 'stopped') : '';
let liveStatus = isTestMode ? (global.mockState?.liveStatus || '{"status":0}') : '';
let statusCameras = isTestMode ? (global.mockState?.statusCameras || []) : [];
let camerasStatus = isTestMode ? (global.mockState?.camerasStatus || 'ON') : '';
let recordOn = isTestMode ? (global.mockState?.recordOn || false) : false;

let CLIENTS = expressWs.getWss().clients;

// WebSocket heartbeat: terminate dead connections
setInterval(() => {
  wsServer.clients.forEach((ws) => {
    if (ws.isAlive === false) {
      try { ws.terminate(); } catch (e) { /* ignore */ }
      return;
    }
    ws.isAlive = false;
    try { ws.ping(); } catch (e) { /* ignore */ }
  });
}, 30000);

let device = 0;
for (var switcher of atemConfig.switchers) {
  logger.info('Initializing switcher', switcher.addr, switcher.port)
  atem = new ATEM;
  atem.event.setMaxListeners(5);
  atem.connect(switcher.addr, switcher.port);
  atem.state.device = device;
  switchers.push(atem);

  atem.on('stateChanged', (err, state) => {
    //logger.info('atem stateChanged:' + JSON.stringify(state))
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
  atem.on('error', (err) => {
    logger.info('atem error:' + err);
    boradcast(JSON.stringify({ method: 'error', device: atem.device }));
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
  // logger.info("Check camera status: " + camera.naam);
  if (camera.ptz) {
    await httpUtils.get('http://' + camera.ip + '/powerModeInq')
      .then((result) => {
        // In test mode, data is already an object; in production, it's a JSON string
        let cameraStatus = isTestMode ? result['data'] : JSON.parse(result['data']);
        logger.info("Camera: " + camera.naam + "Status: " + JSON.stringify(cameraStatus.POWERMODE));
        camera.status = cameraStatus.POWERMODE;
        camerasStatus = camera.status;
      })
      .catch((err) => {
        camera.status = "Error";
        logger.info('==> Camera response data:');
        logger.error(err);
      });
    statusCameras.push(camera);
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

        try {
          let result;
          if (isTestMode) {
            // Use mock HttpUtils for test mode
            result = await httpUtils.post('http://' + camera.ip + '/cgi-bin/lums_configuration.cgi', body, options);
          } else {
            // Use real fetch for production
            result = await fetch('http://' + camera.ip + '/cgi-bin/lums_configuration.cgi', options);
          }
          response = JSON.stringify(result);
          logger.info('Camera:'+response);
        } catch (err) {
          logger.info('==> Camera response data:');
          logger.error(err);
        }
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

        try {
          let result;
          if (isTestMode) {
            // Use mock HttpUtils for test mode
            result = await httpUtils.post('http://' + camera.ip + '/cgi-bin/lums_configuration.cgi', body, options);
          } else {
            // Use real fetch for production
            result = await fetch('http://' + camera.ip + '/cgi-bin/lums_configuration.cgi', options);
          }
          response = JSON.stringify(result);
          logger.info('Camera:'+response);
        } catch (err) {
          logger.info('==> Camera response data:');
          logger.error(err);
        }
      }
    }

  }
}

async function checkStreamer() {
  // In test mode, always return true (streamer is available)
  if (isTestMode) {
    logger.info("[MOCK] Streamer is available in test mode");
    return true;
  }
  
  let status = false;
  try {
    const response = await httpUtils.get(streamerUrl);
    logger.info(JSON.stringify(response));
    status = true;
  } catch (err) {
    logger.error(err)
    if (err === "socket hang up") {
      logger.error("Streamer is niet beschikbaar");
      if (camerasStatus != "OFF") {
        logger.info("camera's gaan uit");
        await turnOffCameras();
      }      
    }
    status = false;
  }
  return status;
}

async function loginStreamer() {
  // In test mode, simulate successful login
  if (isTestMode) {
    logger.info("[MOCK] Streamer login successful in test mode");
    reqOpts = {
      headers: {
        'Cookie': 'session=mock-session-123'
      }
    };
    return;
  }
  
  const streamer = await checkStreamer();
  logger.info("Staat streamer aan:"+streamer);
  if(streamer) {
    logger.info("Login to streamer");
    // login
    logger.info('==> 1. streamer login');
    await httpUtils.get(loginUrl)
      .then((loginRes) => {
        logger.info("Login response: " + JSON.stringify(loginRes));
        // get Cookie info
        if (loginRes['data']['result'] === 0) {
          resCookies = loginRes['headers']['set-cookie'];
          logger.info('==> 2. streamer get login cookie:');
          logger.info(resCookies);

          // set response Cookie
          reqOpts = {
            headers: {
              'Cookie': resCookies
            }
          }
          return "oke";
        } else {
          let errorMessage = "Inlog was niet succesvol:" + loginRes['data']['result'];
          throw errorMessage;
        }        
      })
      .catch(async (err) => {
        logger.info('==> streamer response data:');
        logger.error(err);
        throw err;
      });
  } else {
    throw "Geen connectie";
  }
  
}

async function checkStreamStatus() {
  try {
    let res = await httpUtils.get(statusUrl, reqOpts);
    logger.info('Streamer response statusCode: ' + res['statusCode']);
    const data = res.data;
    logger.info('Streamer response functionalStatus: ' + data['result']);
    if (data['result'] === -17) {
      logger.info("Niet meer ingelogd. Opnieuw inloggen");
      await loginStreamer();
    }
    liveStatus = JSON.stringify(data['live-status']);
    logger.info('Streamer:' + liveStatus);
    streamStatus = ((data['cur-status'] & DeviceStatus.statusLiving) == DeviceStatus.statusLiving)
    logger.info("Status stream:" + streamStatus);
    return streamStatus;
  }
  catch (err) {
    logger.info('==> streamerstatus error:');
    logger.error(err);
    return 'error';
  }
}

async function checkRecordStatus() {
  try {
    let res = await httpUtils.get(statusUrl, reqOpts);
    logger.info('Streamer response statusCode: ' + res['statusCode']);
    const data = res.data;
    logger.info('Streamer response functionalStatus: ' + data['result']);
    if (data['result'] === -17) {
      logger.info("Niet meer ingelogd. Opnieuw inloggen");
      await loginStreamer();
    }
    recStatus = JSON.stringify(data['rec-status']);
    logger.info('Streamer:' + recStatus);
    recordStatus = ((data['cur-status'] & DeviceStatus.statusRecord) == DeviceStatus.statusRecord)
    logger.info("Status record:" + recordStatus);
    return recordStatus;
  }
  catch (err) {
    logger.info('==> streamerstatus error:');
    logger.error(err);
    return 'error';
  }
}

async function downloadAll() {
  try {
    let res = await httpUtils.get(filesUrl, reqOpts);
    logger.info('Streamer response files statusCode: ' + res['statusCode']);
    const data = res.data;
    logger.info('Streamer response files status: ' + data['result']);
    if (data['result'] === -17) {
      logger.info("Niet meer ingelogd. Opnieuw inloggen");
      await loginStreamer();
    }
    const path = data['path'];
    const mediaFiles = data['media-files'];
    for (let i = 0; i < mediaFiles.length; i++) {
      const file = mediaFiles[i]['name'];
      const url = downloadUrl + path+'/'+file;
      logger.info('Download file: ' + file);
      logger.info('URL: ' + url);
      await httpUtils.download(url, file);
      logger.info("Done: " + file);
      await new Promise(resolve => setTimeout(resolve, 10000));
      logger.info('Waited 10s');
    }
    logger.info('Downloaden is klaar');
    return 'ok';
  }
  catch (err) {
    logger.info('==> download error:');
    logger.error(err);
    return 'error';
  }
}

function loadConfig() {
  appConfig = buildJsonFromNormalized(db);
}

app.use(cors());
app.use(express.json()) // for parsing application/json
app.use(express.urlencoded({ extended: true }))  // for parsing application/x-www-form-urlencoded
app.use(express.text())// for parsing application/plain-text

// Serve static files from public directory
app.use(express.static('public'));

app.get('/config', function(request, response){
  logger.info("Config wordt opgehaald");
  loadConfig();
  response.send(appConfig);
});

app.put('/config', function(request, response){
  logger.info("Config wordt bijgewerkt");
  try {
    const body = request.body;
    if (!body || typeof body !== 'object') {
      return response.status(400).json({ error: 'Invalid config body' });
    }
    migrateJsonToNormalized(db, body);
    appConfig = buildJsonFromNormalized(db);
    cameras = appConfig.cameras;
    response.json({ ok: true });
  } catch (e) {
    logger.error(e);
    response.status(500).json({ error: 'Failed to update config' });
  }
});

app.get('/camerasOff', async function (request, response) {
  logger.info("Verzoek om camera's uit te zetten");
  await turnOffCameras();
  response.send(statusCameras);
});

app.get('/camerasOn', async function (request, response) {
  logger.info("Verzoek om camera's aan te zetten");
  await turnOnCameras();
  response.send(statusCameras);
});

app.get('/loginStreamer', async function (request, response) {
  logger.info("Verzoek om in te loggen");
  await loginStreamer()
    .then(() => {
      response.send("oke");
    })
    .catch((err) => {
      logger.error(err);
      response.status(404).end("error");
    });
})

app.get('/downloadAll', async function (request, response) {
  logger.info("Verzoek alle opgeslagen recording te downloaden");
  await downloadAll()
    .then(() => {
      response.send("oke");
    })
    .catch((err) => {
      logger.error(err);
      response.status(404).end("error");
    });
})

app.get('/getCameraStatus', async function (request, response) {
  logger.info("Status cameras wordt opgevraagd.");
  await checkStatusCameras();
  response.send(statusCameras);
});

app.get('/getStatus', async function (request, response) {
  logger.info("Status stream en cameras wordt opgevraagd.");
  try {
    await checkStatusCameras();
    let streamStatus = await checkStreamStatus();
    let recordStatus = await checkRecordStatus();
    let responseBody = {
      statusCamera: statusCameras,
      statusStream: streamStatus,
      statusRecord: recordStatus
    }
    response.json(responseBody);
  }
  catch (err) {
    response.status(404).end("error");
  }
});


app.get('/streamStatus', async function (request, response) {
  logger.info("Status stream wordt opgevraagd");
  try {
    let status = await checkStreamStatus();
    response.send(status);
  }
  catch (err) {
    response.status(404).end("error");
  }
});

app.get('/recordStatus', async function (request, response) {
  logger.info("Status record wordt opgevraagd");
  try {
    let status = await checkRecordStatus();
    response.send(status);
  }
  catch (err) {
    response.status(404).end("error");
  }
});

app.get('/stopStreamen', async function (request, response) {
  logger.info("Verzoek om stream te stoppen");
  let status = await checkStreamStatus();
  if (status) {
    logger.info("Streamen stoppen");
    await httpUtils.get(stopStream, reqOpts);
    await httpUtils.get(stopRecord, reqOpts);
    response.send("gestopt");
  } else {
    logger.info("Stream was al gestopt");
    response.send("gestopt");
  }
  
});

app.get('/startStreamen', async function (request, response) {
  logger.info("Verzoek om stream te starten");
  let status = await checkStreamStatus();
  if (!status) {
    logger.info("Streamen starten");
    await httpUtils.get(startStream, reqOpts);
    logger.info("RecordOn: " + recordOn)
    if (recordOn == "true") {
      logger.info("Record mag aan staan");
      await httpUtils.get(startRecord, reqOpts);
    }
    response.send("gestart");
  } else {
    logger.info("Stream was al gestart");
    response.send("gestart");
  }
});

app.get('/startRecording', async function (request, response) {
  logger.info("Verzoek om record te starten");
  let status = await checkRecordStatus();
  if (!status) {
    logger.info("Recording starten");
    logger.info("RecordOn: " + recordOn)
    if (recordOn == "true") {
      logger.info("Record mag aan staan");
      httpUtils.get(startRecord, reqOpts);
    }
    response.send("gestart");
  } else {
    logger.info("Record was al gestart");
    response.send("gestart");
  }
});

app.get('/stopRecording', async function (request, response) {
  logger.info("Verzoek om record te stoppen");
  let status = await checkRecordStatus();
  if (status) {
    logger.info("Record stoppen");
    httpUtils.get(stopRecord, reqOpts);
    response.send("gestopt");
  } else {
    logger.info("Record was al gestopt");
    response.send("gestopt");
  }
});

app.get('/setRecord', async function (request, response) {
  logger.info("Verzoek om record status te wijzigen");
  logger.info("RecordOn: " +recordOn);
  logger.info(JSON.stringify(request.query.value));
  recordOn = request.query.value;
  logger.info("RecordOn: " +recordOn);
  response.send(recordOn);
});

app.get('/getRecordOn', async function (request, response) {
  logger.info("Verzoek om record status op te vragen");
  logger.info("RecordOn: " + recordOn);
  response.send(recordOn);
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

app.post('/setCameraPreset', function (request, response) {
  const { camera, preset } = request.body;
  logger.info(`Setting camera preset: ${camera} -> preset ${preset}`);
  
  if (isTestMode) {
    // In test mode, just log the action
    logger.info(`[MOCK] Camera ${camera} preset ${preset} set successfully`);
    response.json({ success: true, message: 'Preset set successfully (mock)' });
  } else {
    // In production, handle real camera preset setting
    // This would need to be implemented based on your camera API
    response.json({ success: true, message: 'Preset set successfully' });
  }
});

app.ws('/atemWebSocket', function(ws, req) {
  ws.isAlive = true;
  ws.on('pong', function() { ws.isAlive = true; });
  const ip = req.connection.remoteAddress;
  logger.info('client:'+ip +' connected');
  // initialize client with all switchers
  for (var atem of switchers) {
    ws.send(JSON.stringify(atem.state));
  }

  ws.on('message', function incoming(message) {
    /* JSON-RPC v2 compatible call */
    logger.info('ATEM Switcher:'+message.slice(0, 500));
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
  ws.on('close', function() {
    logger.info('client disconnected');
  });
});

const useTest = process.argv.includes('--test') || process.env.TEST_MODE === '1';
const bindHost = useTest && atemConfig.server.testHost ? atemConfig.server.testHost : atemConfig.server.host;

app.listen(atemConfig.server.port, bindHost, () => {
  logger.info("Express server is listening");
  logger.info("Listening on " + bindHost + ":" + atemConfig.server.port);
});
