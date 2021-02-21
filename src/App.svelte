<script>
  const OBS_WEBSOCKET_LATEST_VERSION = '4.8.0'; // https://api.github.com/repos/Palakis/obs-websocket/releases/latest

  // Imports
  import { onMount } from 'svelte';
  import './style.scss';
  import { mdiWeatherNight, mdiWhiteBalanceSunny, mdiCommentTextOutline, mdiSpeakerOff, mdiSpeaker, mdiBorderVertical,
    mdiAccessPoint, mdiAccessPointOff, mdiRecord, mdiStop, mdiCheckboxMarked, mdiAlert, mdiCloseOctagon} from '@mdi/js';
  import Icon from 'mdi-svelte';
  import compareVersions from 'compare-versions';
  import * as obsConfig from './config.json';

  // Import OBS-websocket
  import OBSWebSocket from 'obs-websocket-js';
  const obs = new OBSWebSocket();

  // Import local components
  import SceneView from './SceneView.svelte';

  onMount(async () => {
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

    // Connect with parameters in config.json
    host = `${obsConfig.host}`;
    password = `${obsConfig.password}`;
    configuredStreamBitrate = `${obsConfig.configuredStreamBitrate}`;
    beginDienst = `${obsConfig.beginDienst}`;
    audioDevice = `${obsConfig.audioDevice}`;
    screenSizeX = `${obsConfig.screenSizeX}`;
    screenSizeY = `${obsConfig.screenSizeY}`;
    camera1IP = `${obsConfig.camera1IP}`;
    camera1User = `${obsConfig.camera1User}`;
    camera1Password = `${obsConfig.camera1Password}`;
    camera1ZoomScene = `${obsConfig.camera1ZoomScene}`;
    camera1OverzichtPreset = `${obsConfig.camera1OverzichtPreset}`;
    camera1ZoomPreset = `${obsConfig.camera1ZoomPreset}`;
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
    ochtendProfiel,
    avondProfiel,
    isMuted,
    wakeLock,
    previewClass = false;
  let scenes =[];
  let scenesList = [];
  let configuredStreamBitrate,
    streamBitrate,
    screenSizeX,
    screenSizeY,
    bitrateStatus,
    camera1OverzichtPreset,
    camera1ZoomPreset= 0;
  let host,
    password,
    errorMessage,
    audioDevice,
    beginDienst,
    camera1IP,
    camera1User,
    camera1Password,
    camera1ZoomScene = '';
  $: sceneChunks = Array(Math.ceil(scenes.length / 4))
    .fill()
    .map((_, index) => index * 4)
    .map(begin => scenes.slice(begin, begin + 4));


  function toggleLiturgieMode() {
    isLiturgieMode = !isLiturgieMode;
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
    const monthNames = ["januari", "februari", "maart", "april", "mei", "juni",
      "juli", "augustus", "september", "oktober", "november", "december"
    ];
    nextScene = e.currentTarget.textContent;

    if(nextScene != camera1ZoomScene){
      await sendPresetToCam(camera1OverzichtPreset);
    }
    if(nextScene == camera1ZoomScene){
      await sendPresetToCam(camera1ZoomPreset);
    }

    if(nextScene == beginDienst) {
      var d = new Date();
      var day = d.getDate();
      var month = monthNames[d.getMonth()];
      var year = d.getFullYear();
      await sendCommand('SetTextFreetype2Properties', { 'source': 'Datum', 'text': day +' '+month+' '+year,
        'font': { 'face': 'Arial', 'flags': 0, 'size': 140, 'style': 'Regular' }});
      let data = await sendCommand('GetSceneItemProperties', {'scene-name': beginDienst, 'item' : 'Datum'});
      let posX = (screenSizeX/2) - (data.sourceWidth/2);
      let posY = (screenSizeY/2) - (data.sourceHeight/2);
      await sendCommand('SetSceneItemProperties', {'scene-name': beginDienst, 'item' : 'Datum', 'position': {'x': posX, 'y': posY}});
    }
    await sendCommand('SetCurrentScene', { 'scene-name': nextScene });
  }

  async function sendPresetToCam(preset){
    const url = "http://"+ camera1IP +"/cgi-bin/lums_configuration.cgi";

    const body = JSON.stringify({"cmd":"campresetrecall", "memnum": preset});

    const options = {
      mode: 'no-cors',
      credentials: 'include',
      method: 'post',
      headers: {
        'Cookie': 'Cookie: userName='+camera1User+'; passWord='+camera1Password+';'
      },
      body: body
    }

    await fetch(url, options).catch(err => {
      console.error('Request failed', err)
    })
  }

  async function setAvondProfiel(){
    await sendPictureProfile(JSON.stringify({"cmd": "gammanameindex", "value": "1"}));
    await sendPictureProfile(JSON.stringify({"cmd": "brightnessnameindex", "value": "1"}));
    await sendPictureProfile(JSON.stringify({"cmd": "huenameindex", "value": "1"}));
    await sendPictureProfile(JSON.stringify({"cmd": "saturationnameindex", "value": "1"}));
    await sendPictureProfile(JSON.stringify({"cmd": "sharpnessnameindex", "value": "1"}));
    avondProfiel = true;
    ochtendProfiel = false;
  }

  async function setOchtendProfiel(){
    await sendPictureProfile(JSON.stringify({"cmd": "gammanameindex", "value": "3"}));
    await sendPictureProfile(JSON.stringify({"cmd": "brightnessnameindex", "value": "7"}));
    await sendPictureProfile(JSON.stringify({"cmd": "huenameindex", "value": "8"}));
    await sendPictureProfile(JSON.stringify({"cmd": "saturationnameindex", "value": "3"}));
    await sendPictureProfile(JSON.stringify({"cmd": "sharpnessnameindex", "value": "7"}));
    avondProfiel = false;
    ochtendProfiel = true;
  }

  async function sendPictureProfile(body){

    const url = "http://"+ camera1IP +"/cgi-bin/lums_piceffect.cgi";

    const options = {
      mode: 'no-cors',
      credentials: 'include',
      method: 'post',
      headers: {
        'Cookie': 'Cookie: userName='+camera1User+'; passWord='+camera1Password+';'
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
    await sendCommand('ToggleMute', { 'source': audioDevice });
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
    let numberOfScenes = scenes.length;
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

    console.log('Scenes updated');
  }

  async function getStudioMode() {
    let data = await sendCommand('GetStudioModeStatus');
    isStudioMode = (data && data.studioMode) || false;
  }

  async function getMuteStatus() {
    let data = await sendCommand('GetMute', { 'source': audioDevice });
    isMuted = (data && data.muted) || false;
    console.log(data);
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
  }

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
    await sendCommand('SetHeartbeat', { enable: true });
    await getStudioMode();
    await updateScenes();
    await getScreenshot();
    await getMuteStatus();
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
                  Stop stream ({heartbeat.totalStreamTime} secs)
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
                <a on:click={isStudioMode ? setPreview : setScene} class="tile is-child is-info notification">
                  <p class="subtitle has-text-centered is-size-7-mobile">{sc.name}</p>
                </a>
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
      <a class:is-primary={ochtendProfiel} class="button" on:click={setOchtendProfiel} title="Ochtend profiel camera">
          <span class="icon">
            <Icon path={mdiWhiteBalanceSunny} />
          </span>
      </a>
      <!-- svelte-ignore a11y-missing-attribute -->
      <a class:is-primary={avondProfiel} class="button" on:click={setAvondProfiel} title="Avond profiel camera">
          <span class="icon">
              <Icon path={mdiWeatherNight} />
          </span>
      </a>
    </div>
  </div>
</nav>
