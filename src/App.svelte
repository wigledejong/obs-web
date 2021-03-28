<script>
  const OBS_WEBSOCKET_LATEST_VERSION = '4.8.0'; // https://api.github.com/repos/Palakis/obs-websocket/releases/latest

  // Imports
  import { onMount } from 'svelte';
  import './style.scss';
  import { mdiCameraBurst, mdiCctv, mdiCameraOff, mdiCamera, mdiWeatherNight, mdiWhiteBalanceSunny, mdiCommentTextOutline, mdiSpeakerOff, mdiSpeaker, mdiBorderVertical,
    mdiAccessPoint, mdiAccessPointOff, mdiRecord, mdiStop, mdiCheckboxMarked, mdiAlert, mdiCloseOctagon} from '@mdi/js';
  import Icon from 'mdi-svelte';
  import compareVersions from 'compare-versions';

  // Import OBS-websocket
  import OBSWebSocket from 'obs-websocket-js';
  const obs = new OBSWebSocket();

  import { ATEM } from "./atem.js";


  // Import local components
  import SceneView from './SceneView.svelte';

  onMount(async () => {
    await fetch('http://192.168.178.28:8081/config')
      .then(res => res.json())
      .then(data => appConfig = data)
    console.log(appConfig);
    host = `${appConfig.host}`;
    password = `${appConfig.password}`;
    configuredStreamBitrate = `${appConfig.configuredStreamBitrate}`;
    beginDienst = `${appConfig.beginDienst}`;
    audioSource = `${appConfig.audioSource}`;
    audioDevice = `${appConfig.audioDevice}`;
    screenSizeX = `${appConfig.screenSizeX}`;
    screenSizeY = `${appConfig.screenSizeY}`;
    cameras = appConfig.cameras;
    presetsScene = appConfig.presetsScene;
    presetsConfig = appConfig.presets;
    avondProfiel = appConfig.avondProfiel;
    ochtendProfiel = appConfig.ochtendProfiel;
    await fetch('http://192.168.178.28:8081/getSceneAndCamera')
      .then(res => res.json())
      .then(data => sceneAndCamera = data)

    for (let key in presetsConfig){
      presets.push(presetsConfig[key]);
    }


    isLoaded = true;
    if ('serviceWorker' in navigator) {
      await navigator.serviceWorker.register('/service-worker.js');
    }

    // Hamburger menu
    const $navbarBurgers = Array.prototype.slice.call(document.querySelectorAll('.navbar-burger'), 0);
    if ($navbarBurgers.length > 0) {
      $navbarBurgers.forEach(el => {
        el.addEventListener('click', () => {
          const target = document.getElementById(el.dataset.target);
          el.classList.toggle('is-active');
          target.classList.toggle('is-active');
        });
      });
    }


    datum = new Date();
    if(datum.getHours() < 16){
      await setCameraProfile(ochtendProfiel, false);
    }
    else {
      await setCameraProfile(avondProfiel, true);
    }

    await connect();

    if (document.location.hash != '') {
      // Read host from hash
      host = document.location.hash.slice(1);
      await connect();
    }

    // Dropdown menu
    const $dropdown = document.querySelector('.has-dropdown');
    if ( $dropdown != null){
      $dropdown.addEventListener('click', () => {
        $dropdown.classList.toggle('is-active');
      });
    }

  });

  // State
  let connected,
    heartbeat,
    streamStatus,
    currentScene,
    nextScene,
    currentPreviewScene,
    currentSceneCollection,
    isStudioMode,
    isLiturgieMode,
    isOchtend,
    isAvond,
    isMuted,
    previewClass,
    cameraOn,
    datum,
    isLoaded = false;
  let scenes =[];
  let switchers = [];
  let scenesList = [];
  let avondProfiel = [];
  let ochtendProfiel = [];
  let cameras = [];
  let presetsScene = [];
  let presets = [];
  let presetsConfig = [];
  let configuredStreamBitrate,
    streamBitrate,
    screenSizeX,
    screenSizeY,
    bitrateStatus,
    intervalID = 0;
  let host,
    password,
    errorMessage,
    audioSource,
    audioDevice,
    savedPreset,
    beginDienst= '';
  let atemWebSocket;
  let appConfig;
  let sceneChunks;
  let sceneAndCamera = true;

  $: if(sceneAndCamera){
      sceneChunks = Array(Math.ceil(scenes.length / 4))
      .fill()
      .map((_, index) => index * 4)
      .map(begin => scenes.slice(begin, begin + 4));
    } else {
      scenes = scenes.concat(presets);
      sceneChunks = Array(Math.ceil(scenes.length / 4))
      .fill()
      .map((_, index) => index * 4)
      .map(begin => scenes.slice(begin, begin + 4));
   }

  function toggleLiturgieMode() {
    isLiturgieMode = !isLiturgieMode;
  }

  function connectAtem() {
    console.log("Opening ATEM websocket...");
    atemWebSocket = new WebSocket("ws://"+ appConfig.atemServer + "/atemWebSocket");
    atemWebSocket.addEventListener("open", function(event) {
      console.log("Websocket ATEM opened");
      intervalID = clearTimeout(intervalID);
      switchers[0] = new ATEM();
      switchers[0].setWebsocket(atemWebSocket);
      // update svelte
      atemWebSocket = atemWebSocket;
    });
    atemWebSocket.addEventListener("message", function(event) {
      let data = JSON.parse(event.data);
      let device = data.device || 0;
      console.log(data);
      switch (data.method) {
        case 'connect':
          switchers[device].connected = true;
          break;
        case 'disconnect':
          switchers[device].connected = false;
          break;
        default:
          switchers[device].connected = true;
          switchers[device].state = data;
      }
      return data;

    });
    atemWebSocket.addEventListener("error", function() {
      console.log("Websocket ATEM error");
      intervalID = setTimeout(connectAtem, 1000);
    });``
    atemWebSocket.addEventListener("close", function() {
      console.log("Websocket ATEM closed");
      intervalID = setTimeout(connectAtem, 1000);
    });
  }

  async function toggleStudioMode() {
    await sendCommand('ToggleStudioMode');
  }

  // OBS functions
  async function sendCommand(command, params) {
    try {
      return await obs.send(command, params || {});
    } catch (e) {
      console.log('Error sending command', command, ' - error is:', e);
      return {};
    }
  }

  async function nextSlide() {
    await sendCommand('TriggerHotkeyBySequence', { 'keyId':'OBS_KEY_N', 'keyModifiers' : { 'shift': true, 'control': true } } )
    console.log('Next Slide');
  }

  async function previousSlide() {
    await sendCommand('TriggerHotkeyBySequence', { 'keyId':'OBS_KEY_P', 'keyModifiers' : { 'shift': true, 'control': true } } )
    console.log('Previous Slide');
  }

  async function setScene(e) {
    isLoaded = false;
    const monthNames = ["januari", "februari", "maart", "april", "mei", "juni",
      "juli", "augustus", "september", "oktober", "november", "december"
    ];
    nextScene = e.currentTarget.textContent;

    if (nextScene != "Collecte") {
     if(sceneAndCamera){
       let preset = presetsScene[nextScene];
       if (!preset) {
         preset = presetsScene["default"];
       }
       await setCameraPreset(preset);
     }
    }

    if (nextScene == beginDienst) {
      var day = datum.getDate();
      var month = monthNames[datum.getMonth()];
      var year = datum.getFullYear();
      await sendCommand('SetTextFreetype2Properties', {
        'source': 'Datum', 'text': day + ' ' + month + ' ' + year,
        'font': {'face': 'Arial', 'flags': 0, 'size': 140, 'style': 'Regular'}
      });
      let data = await sendCommand('GetSceneItemProperties', {'scene-name': beginDienst, 'item': 'Datum'});
      let posX = (screenSizeX / 2) - (data.sourceWidth / 2);
      let posY = (screenSizeY / 2) - (data.sourceHeight / 2);
      await sendCommand('SetSceneItemProperties', {
        'scene-name': beginDienst,
        'item': 'Datum',
        'position': {'x': posX, 'y': posY}
      });
    }
    await sendCommand('SetCurrentScene', {'scene-name': nextScene});
    isLoaded = true;
  }


  async function setPreset(e){
    isLoaded = false;
    let nextPreset = e.currentTarget.textContent;
    await setCameraPreset(presetsConfig[nextPreset]);

    const options = {
      method: 'POST',
      headers: new Headers({'content-type': 'application/json'}),
      mode: 'no-cors',
      body: nextPreset
    };

    await fetch('http://'+ appConfig.atemServer +'/savePreset', options);
    getSavedPreset();
    isLoaded = true;
  }

  async function getSavedPreset(){
    let preset = '';
    await fetch('http://'+ appConfig.atemServer +'/getPreset')
      .then(res => res.text())
      .then(data => preset = data);
    savedPreset = preset;
  }

  async function setSceneAndCamera(){
    isLoaded = false;
    sceneAndCamera = !sceneAndCamera;

    const options = {
      method: 'POST',
      headers: new Headers({'content-type': 'application/json'}),
      mode: 'no-cors',
      body: sceneAndCamera
    };

    await fetch('http://'+ appConfig.atemServer +'/setSceneAndCamera', options);
    updateScenes();
    isLoaded = true;
  }

  async function setCameraProfile(profiel, avond){
    for (let key in cameras){
      let camera = cameras[key];
      let profileUrl = "http://"+ camera.ip +"/cgi-bin/lums_piceffect.cgi";
      for (let key of Object.keys(profiel)) {
        let value = profiel[key];
        if(appConfig.connectToLumens){
          await sendCommandToLumens(profileUrl, JSON.stringify({"cmd": key, "value": value}), camera);
        }
      }
    }

    isAvond = avond;
    isOchtend = !avond;
  }

  async function setCameraPreset(preset){
    console.log(preset);
    if(appConfig.connectToAtem){
      switchers[0].changeProgramInput(preset.atemInput);
    }
    let camera = cameras[preset.camera];
    let presetUrl =  "http://"+ camera.ip +"/cgi-bin/lums_configuration.cgi";
    console.log("Connect To Lumens:" + appConfig.connectToLumens);
    if(appConfig.connectToLumens){
      await sendCommandToLumens(presetUrl, JSON.stringify({"cmd":"campresetrecall", "memnum": preset.preset}), camera);
    }
  }

  async function powerModeCameras(){
    isLoaded = false;
    for (let key in cameras){
      let camera = cameras[key];
      let configUrl =  "http://"+ camera.ip +"/cgi-bin/lums_configuration.cgi";
      if (cameraOn){
        if(appConfig.connectToLumens){
          await sendCommandToLumens(configUrl, JSON.stringify({"cmd": "campowerModeAction", "powermode": "0"}), camera);
        }
      } else{
        if(appConfig.connectToLumens){
          await sendCommandToLumens(configUrl, JSON.stringify({"cmd": "campowerModeAction", "powermode": "1"}), camera);
        }
      }
    }
    isLoaded = true;
  }

  async function sendCommandToLumens(url, body, camera){
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
        "Cookie": "Cookie: userName="+camera.user+"; passWord="+camera.password+";"
      },
      body: body
    }

    await fetch(url, options).catch(err => {
      console.error('Request failed', err)
    })
  }

  async function changeSceneCollection(e){
    await sendCommand('SetCurrentSceneCollection', { 'sc-name': e.currentTarget.textContent.trim() });
  }

  async function transitionScene(e) {
    await sendCommand('TransitionToProgram');
  }

  async function setPreview(e) {
    await sendCommand('SetPreviewScene', { 'scene-name': e.currentTarget.textContent });
  }

  async function startStream() {
    await sendCommand('StartStreaming');
  }

  async function stopStream() {
    await sendCommand('StopStreaming');
  }

  async function startRecording() {
    await sendCommand('StartRecording');
  }

  async function stopRecording() {
    await sendCommand('StopRecording');
  }

  async function toggleMute() {
    await sendCommand('ToggleMute', { 'source': audioSource });
    console.log('Muted triggerd');
    await getMuteStatus();
  }

  async function updateScenes() {
    let retrievedSC = await sendCommand('GetCurrentSceneCollection')
    currentSceneCollection = retrievedSC.scName;

    let retrievedLSC = await sendCommand('ListSceneCollections');
    scenesList = retrievedLSC.sceneCollections;

    let data = await sendCommand('GetSceneList');
    currentScene = data.currentScene;
    scenes = data.scenes.filter(i => {
      return i.name.indexOf('(hidden)') === -1;
    }); // Skip hidden scenes

    if (isStudioMode) {
      obs
        .send('GetPreviewScene')
        .then(data => (currentPreviewScene = data.name))
        .catch(_ => {
          // Switching off studio mode calls SwitchScenes, which will trigger this
          // before the socket has recieved confirmation of disabled studio mode.
        });
    }
    let numberOfScenes = 0;
    if(!sceneAndCamera){
      numberOfScenes = scenes.length + presets.length;
    } else{
      numberOfScenes = scenes.length;
    }


    let sceneRows = numberOfScenes / 4;

    if (sceneRows <= 1){
      previewClass = 'preview-1row';
    }else if (sceneRows <= 2){
      previewClass = 'preview-2row';
    } else if (sceneRows <= 3){
      previewClass = 'preview-3row';
    }else if (sceneRows <= 4){
      previewClass = 'preview-4row';
    }else if (sceneRows <= 5){
      previewClass = 'preview-5row';
    }
    getSavedPreset();
    console.log(savedPreset);
    console.log('Scenes updated');
  }

  async function getStudioMode() {
    let data = await sendCommand('GetStudioModeStatus');
    isStudioMode = (data && data.studioMode) || false;
  }

  async function getMuteStatus() {
    let data = await sendCommand('GetMute', { 'source': audioSource });
    isMuted = (data && data.muted) || false;
    console.log(data);
  }

  async function setAudioDevice() {
    let audioSources = await sendCommand('GetSourceSettings', {sourceName : audioSource});
    console.log(audioSources);
    await sendCommand('SetSourceSettings', {sourceName: audioSource, sourceSettings: {device_id: audioDevice}});
  }

  async function getScreenshot() {
    if (connected) {
      let data = await sendCommand('TakeSourceScreenshot', { sourceName: currentScene, embedPictureFormat: 'jpg', width: 960, height: 540 });
      if (data && data.img) {
        document.querySelector('#program').src = data.img;
        document.querySelector('#program').className = '';
      }

      if (isStudioMode) {
        let data = await sendCommand('TakeSourceScreenshot', { sourceName: currentPreviewScene, embedPictureFormat: 'jpg', width: 960, height: 540 });
        if (data && data.img) {
          document.querySelector('#preview').src = data.img;
          document.querySelector('#preview').classList.remove('is-hidden');
        }
      }
    }
    setTimeout(getScreenshot, 1);
  }

  async function connect() {
    if(appConfig.connectToAtem){
      connectAtem();
    }
    host = host || 'localhost:4444';
    let secure = location.protocol === 'https:' || host.endsWith(':443');
    if (host.indexOf('://') !== -1) {
      let url = new URL(host);
      secure = url.protocol === 'wss:' || url.protocol === 'https:';
      host = url.hostname + ':' + (url.port ? url.port : secure ? 443 : 80);
    }
    console.log('Connecting to:', host, '- secure:', secure, '- using password:', password);
    await disconnect();
    connected = false;
    try {
      await obs.connect({ address: host, password, secure });
    } catch (e) {
      console.log(e);
      errorMessage = e.description;
    }
    isLoaded = true;
  }

  async function disconnect() {
    await obs.disconnect();
    connected = false;
    errorMessage = 'Disconnected';
  }

  async function hostkey(event) {
    if (event.key !== 'Enter') return;
    await connect();
    event.preventDefault();
  }``

  // OBS events
  obs.on('ConnectionClosed', () => {
    connected = false;
    window.history.pushState('', document.title, window.location.pathname + window.location.search); // Remove the hash
    console.log('Connection closed');
  });

  obs.on('AuthenticationSuccess', async () => {
    console.log('Connected');
    connected = true;
    document.location.hash = host; // For easy bookmarking
    const version = (await sendCommand('GetVersion')).obsWebsocketVersion || '';
    console.log('OBS-websocket version:', version);
    if(compareVersions(version, OBS_WEBSOCKET_LATEST_VERSION) < 0) {
      alert('You are running an outdated OBS-websocket (version ' + version + '), please upgrade to the latest version for full compatibility.');
    }
    isLoaded = false;
    await sendCommand('SetHeartbeat', { enable: true });
    await getStudioMode();
    await updateScenes();
    await getScreenshot();
    await getMuteStatus();
    await setAudioDevice();
    isLoaded = true;
    document.querySelector('#program').classList.remove('is-hidden');
  });

  obs.on('AuthenticationFailure', async () => {
    password = prompt('Please enter your password:', password);
    if (password === null) {
      connected = false;
      password = '';
    } else {
      await connect();
    }
  });

  // Heartbeat
  obs.on('Heartbeat', data => {
    heartbeat = data;
  });

  // StreamStatus
  obs.on('StreamStatus', data =>{
    streamStatus = data;
    streamBitrate = streamStatus['kbits-per-sec'];
    bitrateStatus = streamBitrate / configuredStreamBitrate;
  });

  // StreamStopped
  obs.on("StreamStopped", data => {
    streamStatus = false
  });

  // Scenes
  obs.on('SwitchScenes', async (data) => {
    console.log(`New Active Scene: ${data.sceneName}`);
    await updateScenes();
  });

  obs.on('error', err => {
    console.error('Socket error:', err);
  });

  obs.on('StudioModeSwitched', async (data) => {
    console.log(`Studio Mode: ${data.newState}`);
    isStudioMode = data.newState;
    if (!isStudioMode) {
      currentPreviewScene = false;
    } else {
      await updateScenes();
    }
  });

  obs.on('PreviewSceneChanged', async(data) => {
    console.log(`New Preview Scene: ${data.sceneName}`);
    await updateScenes();
  });
</script>

<svelte:head>
  <title>Hillegonda stream app</title>
</svelte:head>

<div class:loaded={isLoaded} class:loading={!isLoaded} id="loader-wrapper">
  <div id="loader"></div>

  <div class="loader-section section-left"></div>
  <div class="loader-section section-right"></div>

</div>

<nav class="navbar is-info is-fixed-top" role="navigation" aria-label="main navigation">
  <div class="navbar-brand">
    <a class="navbar-item is-size-4 has-text-weight-bold" href="/">
      <img src="favicon.png" alt="Hillegonda stream app" />
      &nbsp; Hillegonda stream app
    </a>

    <!-- svelte-ignore a11y-missing-attribute -->
    <a role="button" class="navbar-burger burger" aria-label="menu" aria-expanded="false" data-target="navmenu">
      <span aria-hidden="true" />
      <span aria-hidden="true" />
      <span aria-hidden="true" />
    </a>
  </div>

  <div id="navmenu" class="navbar-menu">
    <div class="navbar-end">
      {#if connected}
        <div class:is-disable={streamStatus} class="navbar-item has-dropdown">
          <!-- svelte-ignore a11y-missing-attribute -->
          <a class="navbar-link">
            {currentSceneCollection}
          </a>
          <div class="navbar-dropdown">
            <!-- svelte-ignore a11y-missing-attribute -->
            {#each scenesList as sc}
              <a class="navbar-item" on:click={changeSceneCollection}>
                <p>{sc["sc-name"]}</p>
              </a>
            {/each}
          </div>
        </div>
      {/if}
      <div class="navbar-item">
        <div class="buttons">
          <!-- svelte-ignore a11y-missing-attribute -->
          {#if connected}
            {#if heartbeat && heartbeat.streaming}
              <a class="button is-danger" on:click={stopStream}>
                <span class="icon">
                  <Icon path={mdiAccessPointOff} />
                </span>
                <span>
                  Stop stream ({(heartbeat.totalStreamTime)/100000} secs)
                </span>
              </a>
            {:else}
              <a class="button is-primary" on:click={startStream}>
                <span class="icon">
                  <Icon path={mdiAccessPoint} />
                </span>
                <span>
                  Start stream
                </span>
              </a>
            {/if}
            {#if heartbeat && heartbeat.recording}
              <a class="button is-danger" on:click={stopRecording}>
                <span class="icon">
                  <Icon path={mdiStop} />
                </span>
                <span>
                  Stop recording ({heartbeat.totalRecordTime} secs)
                </span>
              </a>
            {:else}
              <a class="button is-primary" on:click={startRecording}>
                <span class="icon">
                  <Icon path={mdiRecord} />
                </span>
                <span>
                  Start recording
                </span>
              </a>
            {/if}
          {:else}
            <a class="button is-danger" disabled>{errorMessage || 'Not connected'}</a>
          {/if}
          <!-- svelte-ignore a11y-missing-attribute -->
        </div>
      </div>
    </div>
  </div>
</nav>

<section class="section mt-5">
  <div class="container is-fluid ">
    {#if connected}
      {#each sceneChunks as chunk}
        <div class="tile is-ancestor">
          {#each chunk as sc}
            <div class="tile is-parent p-1">
              <!-- svelte-ignore a11y-missing-attribute -->
              {#if currentScene == sc.name}
                <a class="tile is-child is-primary notification">
                  <p class="subtitle has-text-centered is-size-7-mobile">{sc.name}</p>
                </a>
              {:else if currentPreviewScene == sc.name}
                <a on:click={setScene} class="tile is-child is-warning notification">
                  <p class="subtitle has-text-centered is-size-7-mobile">{sc.name}</p>
                </a>
              {:else}
                {#if !sc.preset}
                  <a on:click={isStudioMode ? setPreview : setScene} class="tile is-child is-info notification">
                    <p class="subtitle has-text-centered is-size-7-mobile">{sc.name}</p>
                  </a>
                {:else}
                  {#if savedPreset == sc.name}
                    <a on:click={setPreset} class="tile is-child is-primary notification">
                         <p class="subtitle has-text-centered is-size-7-mobile"><Icon path={mdiCctv} />{sc.name}</p>
                    </a>
                  {:else}
                    <a on:click={setPreset} class="tile is-child is-info notification">
                      <p class="subtitle has-text-centered is-size-7-mobile"><Icon path={mdiCctv} />{sc.name}</p>
                    </a>
                  {/if}
                {/if}
              {/if}
            </div>
          {/each}
        </div>
      {/each}
      <SceneView isStudioMode={isStudioMode} transitionScene={transitionScene} nextSlide={nextSlide}
                 previousSlide={previousSlide} isLiturgieMode={isLiturgieMode} previewClass={previewClass}/>
    {:else}
      <p>De connectie had vanzelf moeten gaan. Dit is niet gelukt. Probeer het handmatig.</p>

      <div class="field is-grouped">
        <p class="control is-expanded">
          <input id="host" on:keyup={hostkey} bind:value={host} class="input" type="text" placeholder={host} />
        </p>
        <p class="control">
          <button on:click={connect} class="button is-success">Connect</button>
        </p>

      </div>
      <p class="help">
        Make sure that the
        <a href="https://github.com/Palakis/obs-websocket/releases" target="_blank">obs-websocket plugin</a>
        is installed and enabled.
      </p>
    {/if}
  </div>
</section>
<nav class="navbar is-info is-fixed-bottom" role="navigation" aria-label="main navigation">
  <div class="navbar-item">
    <!-- svelte-ignore a11y-missing-attribute -->
    <a class:is-danger={!sceneAndCamera} class:is-primary={sceneAndCamera} class="button" on:click={setSceneAndCamera} title="Camera Presets">
        <span class="icon">
            <Icon path={mdiCameraBurst} />
        </span>
    </a>
  </div>
  <div class="navbar-start is-justify-content-center is-flex-grow-1">
    <div class="navbar-item">
      <!-- svelte-ignore a11y-missing-attribute -->
      <a class:is-light={!isLiturgieMode} class="button is-link" on:click={toggleLiturgieMode} title="Toggle Studio Mode">
          <span class="icon">
            <Icon path={mdiCommentTextOutline} />
          </span>
      </a>
    </div>
    <div class="navbar-item">
      <!-- svelte-ignore a11y-missing-attribute -->
      <a class:is-light={!isStudioMode} class="button is-link" on:click={toggleStudioMode} title="Toggle Studio Mode">
          <span class="icon">
            <Icon path={mdiBorderVertical} />
          </span>
      </a>
    </div>
    <div class="navbar-item">
      <!-- svelte-ignore a11y-missing-attribute -->
      <a class:is-danger={isMuted} class:is-primary={!isMuted} class="button" on:click={toggleMute} title="Toggle Mute">
          <span class="icon">
            {#if isMuted}
              <Icon path={mdiSpeakerOff} />
            {:else}
              <Icon path={mdiSpeaker} />
            {/if}
          </span>
      </a>
    </div>
    <div class="navbar-item">
      <!-- svelte-ignore a11y-missing-attribute -->
      <a class="button is-info is-light" disabled>
        {#if heartbeat}
          {Math.round(heartbeat.stats.fps)} fps, {Math.round(heartbeat.stats['cpu-usage'])}% CPU, {heartbeat.stats['output-skipped-frames']} skipped frames
          {#if streamStatus}
            , {streamBitrate} kb/s
            {#if bitrateStatus >= 0.8}
                  <span class="icon has-text-success ml-0">
                      &nbsp; <Icon path={mdiCheckboxMarked} />
                  </span>
            {:else if bitrateStatus >= 0.6}
                    <span class="icon has-text-warning ml-0">
                      &nbsp; <Icon path={mdiAlert} />
                    </span>
            {:else}
                    <span class="icon has-text-danger ml-0">
                      &nbsp; <Icon path={mdiCloseOctagon} />
                    </span>
            {/if}
          {/if}
        {:else}Connected{/if}
      </a>
    </div>
    <div class="navbar-item">
      <!-- svelte-ignore a11y-missing-attribute -->
      <a class:is-primary={isOchtend} class="button" on:click={setCameraProfile(ochtendProfiel, false)} title="Ochtend profiel camera">
          <span class="icon">
            <Icon path={mdiWhiteBalanceSunny} />
          </span>
      </a>
    </div>
    <div class="navbar-item">
      <!-- svelte-ignore a11y-missing-attribute -->
      <a class:is-primary={isAvond} class="button" on:click={setCameraProfile(avondProfiel, true)} title="Avond profiel camera">
          <span class="icon">
              <Icon path={mdiWeatherNight} />
          </span>
      </a>
    </div>
  </div>
  <div class="navbar-item">
    <!-- svelte-ignore a11y-missing-attribute -->
    <a class:is-danger={!cameraOn} class:is-primary={cameraOn} class="button" on:click={powerModeCameras} title="Toggle Camera">
        <span class="icon">
          {#if cameraOn}
            <Icon path={mdiCamera} />
          {:else}
            <Icon path={mdiCameraOff} />
          {/if}
        </span>
    </a>
  </div>
</nav>
