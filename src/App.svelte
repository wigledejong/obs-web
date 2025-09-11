<script>

  // Imports
  import { onMount, onDestroy } from 'svelte';
  import './style.scss';
  import { mdiCameraOff, mdiCamera, mdiMicrophoneOff, mdiMicrophone, mdiAccessPoint, mdiAccessPointOff, mdiHeadphonesOff,
    mdiAccessPointRemove, mdiHeadphones, mdiPictureInPictureTopRight, mdiRecordRec, mdiCog} from '@mdi/js';
  import Icon from 'mdi-svelte';

  import { ATEM } from "./atem.js";

  onMount(async () => {
    await loadConfig();
    await loginStreamer();
    await getStatus();
    await checkSession();
    await getSavedUitzending();
    await getSavedPreset();
    await getRecordOn();
    await getScreenshot();
    // Service worker registration removed - not needed for this application
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
    // Dropdown menu
    const $dropdown = document.querySelector('.has-dropdown');
    if ( $dropdown != null){
      $dropdown.addEventListener('click', () => {
        $dropdown.classList.toggle('is-active');
      });
    }
    isLoaded = true;
  });

  // State
  let currentPresetCollection,
    isOchtend,
    isAvond,
    isMuted,
    isPipUit,
    isRecordAan,
    isConnected,
    cameraOn,
    cameraError,
    datum,
    previewClass,
    streaming,
    recording,
    atemConnected,
    isLoaded = false;
  let isMutedPC = true;
  let switchers = [];
  let cameras = [];
  let presets = [];
  let presetsConfig = [];
  let uitzendingVariant = [];
  let presetUitzending = [];
  let intervalID = 0;
  let cameraMessage,
    camerasStatus,
    savedPreset,
    savedUitzending,
    programChannel,
    beginDienst= '';
  let atemWebSocket;
  let appConfig;
  let presetChunks;
  let reconnectAttempts = 0;
  const maxReconnectDelayMs = 30000;
  let serverBase = '';
  
  // Detect if we're in test mode (running on localhost)
  const isTestMode = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  let pollingActive = true;
  let statusTimeoutId = null;
  let screenshotTimeoutId = null;
  let actionLockUntil = 0;
  let toast = '';
  let toastTimer = null;

  function showToast(message, ms = 1200) {
    toast = message;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast = ''; }, ms);
  }

  function canActNow(delayMs = 500) {
    const now = Date.now();
    if (now < actionLockUntil) {
      showToast('Even geduld...');
      return false;
    }
    actionLockUntil = now + delayMs;
    return true;
  }

  // Helper: fetch with timeout and optional JSON/text parsing
  async function fetchWithTimeout(url, options = {}, timeoutMs = 8000, parse = 'json') {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...options, signal: controller.signal });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      if (parse === 'json') return await res.json();
      if (parse === 'text') return await res.text();
      return res;
    } finally {
      clearTimeout(id);
    }
  }

  $: presetChunks = Array(Math.ceil(presets.length / 4))
     .fill()
     .map((_, index) => index * 4)
     .map(begin => presets.slice(begin, begin + 4));

  async function connectAtem() {
    console.log("Opening ATEM websocket...");
    // Use localhost in test mode, otherwise use config server
    const atemHost = isTestMode ? 'localhost:8081' : appConfig.atemServer;
    atemWebSocket = new WebSocket("ws://"+ atemHost + "/atemWebSocket");
    atemWebSocket.addEventListener("open", function(event) {
      console.log("Websocket ATEM opened");
      intervalID = clearTimeout(intervalID);
      switchers[0] = new ATEM();
      switchers[0].setWebsocket(atemWebSocket);
      // update svelte
      atemWebSocket = atemWebSocket;
      reconnectAttempts = 0;
    });

    atemWebSocket.addEventListener("message", async function(event) {
      let data = JSON.parse(event.data);
      let device = data.device || 0;
      switch (data.method) {
        case 'connect':
          console.log("Atem connected");
          switchers[device].connected = true;
          programChannel = switchers[0].returnProgramChannel();
          break;
        case 'disconnect':
          console.log("Atem disconnected");
          switchers[device].connected = false;
          break;
        default:
          if(data._pin){
            switchers[device].connected = true;
            switchers[device].state = data;
            programChannel = switchers[0].returnProgramChannel();
          }
          else {
            console.log("Websocket ATEM error");
          }
          checkAtemState();
      }

      return data;

    });
    atemWebSocket.addEventListener("error", function() {
      console.log("Websocket ATEM error");
    });
    atemWebSocket.addEventListener("close", function() {
      console.log("Websocket ATEM closed");
      // Exponential backoff reconnect
      reconnectAttempts += 1;
      const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), maxReconnectDelayMs);
      setTimeout(() => {
        if (!atemWebSocket || atemWebSocket.readyState === WebSocket.CLOSED) {
          connectAtem();
        }
      }, delay);
    });
  }

  async function loadConfig(){
    let url  = window.location + "";
    url = url.slice(0, url.lastIndexOf("/"));
    url = url.slice(0, url.lastIndexOf(":"));
    await fetch(url+':8081/config')
      .then(async (res) => {
        appConfig = await res.json();
        // Use localhost in test mode, otherwise use config server
        serverBase = isTestMode ? 'http://localhost:8081' : 'http://' + appConfig.atemServer;
        cameras = appConfig.cameras;
        presetsConfig = [];
        presetUitzending = [];
        presetsConfig =  appConfig.presets;
        uitzendingVariant = appConfig.uitzendingVariant;
        presetUitzending = appConfig.presetUitzending;  
      })
      .catch((err) => {
        console.log(err);
      });
  }

  async function loginStreamer(){
    console.log("Login Streamer");
    await fetch(serverBase + '/loginStreamer')
    .then(async (res) => {
      if (res.statusText === "OK"){
        isConnected = true;
        if(!atemWebSocket || atemWebSocket.readyState != WebSocket.OPEN) {
          console.log("atem is niet connected");
          await connectAtem();
        }else{
          console.log("atem is connected");
        }
      }
    })
    .catch((err) => {
      console.log(err);
      isConnected = false;   
    });
    if(!isConnected){
      console.log("Niet geconnect met streamer");
      setTimeout(loginStreamer, 10000);
    }
  }

  async function startStream(){
    if (!canActNow(800)) return;
    if (confirm("Weet je zeker dat je de stream wilt starten?") == true) {
      isLoaded = false;
      try {
        await fetch(serverBase + '/startStreamen');
        await streamStatus();
        // Wait a bit for the stream to start, then check status once more
        setTimeout(async () => {
          await streamStatus();
          isLoaded = true;
        }, 1000);
      } catch (error) {
        console.error('Error starting stream:', error);
        isLoaded = true;
      }
    }
  }

  async function stopStream(){
    if (!canActNow(800)) return;
    if (confirm("Weet je zeker dat je de stream wilt stoppen?") == true) {
      isLoaded = false;
      try {
        await fetch(serverBase + '/stopStreamen');
        await streamStatus();
        // Wait a bit for the stream to stop, then check status once more
        setTimeout(async () => {
          await streamStatus();
          isLoaded = true;
        }, 1000);
      } catch (error) {
        console.error('Error stopping stream:', error);
        isLoaded = true;
      }
    }
  }

  async function startRecord(){
    if (!canActNow(800)) return;
    if (confirm("Weet je zeker dat je de recording wilt starten?") == true) {
      isLoaded = false;
      while(!recording) {
        await fetch(serverBase + '/startRecording').catch(() => {});
        await recordStatus();
      }
      isLoaded = true;
    }
  }

  async function stopRecord(){
    if (!canActNow(800)) return;
    if (confirm("Weet je zeker dat je de recording wilt stoppen?") == true) {
      isLoaded = false;
      while(recording) {
        await fetch(serverBase + '/stopRecording').catch(() => {});
        await recordStatus();
      }
      isLoaded = true;
    }
  }

  async function getStatus(){
   if(isConnected && pollingActive) {
     let cameraOnBool = false;
     let cameraErrorBool = false;
     await fetchWithTimeout(serverBase + '/getStatus', {}, 8000, 'json')
      .then((data) => {
        if(data.statusStream === "error"){
          streaming = false;
          isConnected = false;
          loginStreamer();
        }else{
          streaming = data.statusStream;
        }
        camerasStatus = data.statusCamera
        recording = data.statusRecord
      })
      .catch((err) => {
        console.log(err);
      });
      for (let key in camerasStatus){
        let camera = camerasStatus[key];
        if (camera.status == "ON") {
          cameraOnBool = true;
        } else if (camera.status == "Error") {
          cameraErrorBool = true;
        } 
      }
      cameraOn = cameraOnBool;
      cameraError = cameraErrorBool;
      clearTimeout(statusTimeoutId);
      statusTimeoutId = setTimeout(getStatus, 1000);
    }else{
      streaming = false;
      await statusCameras();
      clearTimeout(statusTimeoutId);
      statusTimeoutId = setTimeout(getStatus, 60000);
    }
  }

  async function statusCameras(){
    let cameraOnBool = false;
    let cameraErrorBool = false;
    await fetch(serverBase + '/getCameraStatus')
      .then(res => res.json())
      .then(data => camerasStatus = data)
    for (let key in camerasStatus){
      let camera = camerasStatus[key];
      if (camera.status == "ON") {
          cameraOnBool = true;
      } else if (camera.status == "Error") {
          cameraErrorBool = true;
      } 
    }
    cameraOn = cameraOnBool;
    cameraError = cameraErrorBool;
  }

  async function streamStatus() {
   await fetch(serverBase + '/streamStatus')
      .then(res => res.json())
      .then(data => streaming = data)
      .catch(err => {
        isConnected = false;
        loginStreamer();
      });
  }

  async function recordStatus() {
   await fetch(serverBase + '/recordStatus')
      .then(res => res.json())
      .then(data => recording = data)
      .catch(err => {
        isConnected = false;
        loginStreamer();
      });
  }

  function checkSession(){
    let date = new Date();
    if(getSession("sessie")){
      let sessieDate = new Date(getSession("sessie"));
      if (date.getTime() < sessieDate.getTime()) {
          console.log('Check session on: '+ date.toISOString() +' result: '+getSession("sessie"));
          setTimeout(checkSession, 60000);
       } else {
          console.log("Sessie verlopen");
          setSession("sessie");
          console.log(getSession("sessie"));
          window.location.reload();
       }
    }else{
      console.log("Cookie niet gezet");
      setSession("sessie");
      console.log(getSession("sessie"));
      window.location.reload();
    }
  }

  function setSession(name) {
    let date = new Date();
    date.setTime(date.getTime() + (2*60*60*1000));
    localStorage.setItem(name, date.toISOString());
  }

  function getSession(name) {
    return localStorage.getItem(name);
  }

  async function setPreset(e){
    if (!canActNow(400)) return;
    isLoaded = false;
    let nextPreset = e.currentTarget.textContent;
    let preset = presetsConfig[nextPreset];
    if(preset != null){
      let camera = cameras[preset.camera];
      if(nextPreset == "Collecte"){
        console.log("collecte");
        runMacro(5);
      }
      if(nextPreset == "Begin dienst"){
        runMacro(7);
      }
      if(nextPreset == "Extra plaatje" || nextPreset == "Pauze"){
        runMacro(9);
        await new Promise(r => setTimeout(r, 2000));
      }
      if(nextPreset == "Beker & Brood"){
        runMacro(11);
        await new Promise(r => setTimeout(r, 2000));
      }
      if(nextPreset == "Begin stream"){
        runMacro(13);
        await new Promise(r => setTimeout(r, 2000));
      }
      

      if(nextPreset == "Collecte" || nextPreset == "Begin dienst"){
        changeAtemChannel(camera.atemChannel);
        await setCameraPreset(presetsConfig["PIPScene"]);
        runMacro(4);
      }else{
        if (preset.preset){
          await setCameraPreset(preset);
        }
        changeAtemChannel(camera.atemChannel);
        if(nextPreset == "Predikant" || nextPreset == "Afkondigingen" || nextPreset == "Spreker"){
          runMacro(18);
        } else{
          runMacro(16);
        }
      }

      const options = {
        method: 'POST',
        headers: new Headers({'content-type': 'application/json'}),
        mode: 'no-cors',
        body: nextPreset
      };

      await fetch(serverBase + '/savePreset', options).catch(() => {});
      // Update local state immediately instead of making another API call
      savedPreset = nextPreset;

    } else {
      alert("De scene: "+nextPreset+" is onbekend");
    }
    isLoaded = true;
  }

  function changeAtemChannel(atemChannel){
    if (!switchers[0]) {
      console.warn('ATEM switcher not connected yet');
      return;
    }
    switchers[0].changePreviewInput(atemChannel);
    switchers[0].cutTransition();
  }
        
  async function changeUitzending(e){
    if (!canActNow(400)) return;
    isLoaded = false;
    let newUitzending = e.currentTarget.textContent.trim();
    
    try {
      const options = {
        method: 'POST',
        headers: new Headers({'content-type': 'application/json'}),
        mode: 'no-cors',
        body: newUitzending
      };

      await fetch(serverBase + '/saveUitzending', options);
      
      // Update local state immediately instead of making another API call
      savedUitzending = newUitzending;
      presets = [];
      
      // Guard against undefined presetUitzending or missing key
      if (presetUitzending && presetUitzending[savedUitzending]) {
        presetUitzending[savedUitzending].forEach(item => presets.push(item));
      } else {
        console.warn('presetUitzending not loaded yet or missing key:', savedUitzending);
      }
      
      console.log('Presets: '+presets);
      calculatePreviewClass(); // Remove await since it's synchronous
    } catch (error) {
      console.error('Error changing uitzending:', error);
    } finally {
      isLoaded = true;
    }
  }

  async function getSavedPreset(){
    let preset = '';
    await fetch(serverBase + '/getPreset')
      .then(res => res.text())
      .then(data => preset = data);
    savedPreset = preset;
  }

  async function getSavedUitzending(){
    let uitzending = '';
    presets = [];
    await fetch(serverBase + '/getUitzending')
      .then(res => res.text())
      .then(data => uitzending = data);
    savedUitzending = uitzending;
    
    // Guard against undefined presetUitzending or missing key
    if (presetUitzending && presetUitzending[savedUitzending]) {
      presetUitzending[savedUitzending].forEach(item => presets.push(item));
    } else {
      console.warn('presetUitzending not loaded yet or missing key:', savedUitzending);
    }
    console.log('Presets: '+presets);
    await calculatePreviewClass();
  }

  function runMacro(macro) {
    if (!switchers[0]) {
      console.warn('ATEM switcher not connected yet');
      return;
    }
    switchers[0].runMacro(macro);
  }

  async function setCameraPreset(preset){
    let camera = cameras[preset.camera];
    console.log(preset);
    
    // In test mode, use server endpoint; in production, use direct camera call
    if (isTestMode) {
      const response = await fetch(serverBase + '/setCameraPreset', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          camera: preset.camera,
          preset: preset.preset
        })
      });
      if (!response.ok) {
        throw new Error('Failed to set camera preset');
      }
    } else {
      let presetUrl =  "http://"+ camera.ip +"/cgi-bin/lums_configuration.cgi";
      await sendCommandToLumens(presetUrl, JSON.stringify({"cmd":"campresetrecall", "memnum": preset.preset}), camera);
    }
  }

  async function changePowerModeCameras(){
    if (!canActNow(1000)) return;
    isLoaded = false;
    
    try {
      if (cameraOn) {
        if (confirm("Weet je zeker dat je camera's wilt uitzetten?") == true) {
          await fetch(serverBase + '/camerasOff');
          // Update local state immediately
          cameraOn = false;
        }
      } else {
        if (confirm("Weet je zeker dat je camera's wilt aanzetten?") == true) {
          await fetch(serverBase + '/camerasOn');
          // Update local state immediately
          cameraOn = true;
        }
      }
    } catch (error) {
      console.error('Error changing camera power mode:', error);
    } finally {
      isLoaded = true;
    }
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

  function toggleMute() {
    if (!canActNow(300)) return;
    if (!switchers[0]) {
      console.warn('ATEM switcher not connected yet');
      return;
    }
    let audio = switchers[0].getAudio();
    if(audio[8].on){
        switchers[0].runMacro(0);
        isMuted = true;
    } else {
      switchers[0].runMacro(2);
        isMuted = false;
    }
  }

  function toggleMutePC() {
    if (!canActNow(300)) return;
    if (!switchers[0]) {
      console.warn('ATEM switcher not connected yet');
      return;
    }
    let audio = switchers[0].getAudio();
    if(audio[0].on){
        switchers[0].runMacro(3);
        isMutedPC = true;
    } else {
      switchers[0].runMacro(1);
        isMutedPC = false;
    }
  }

  function togglePip() {
      if (!canActNow(300)) return;
      if (!switchers[0]) {
        console.warn('ATEM switcher not connected yet');
        return;
      }
      let video = switchers[0].getVideo();
      if(video.ME[0].upstreamKeyState[0]){
          switchers[0].runMacro(16);
          isPipUit = true;
      } else {
        switchers[0].runMacro(4);
          isPipUit = false;
      }
  }

  async function toggleRecord() {
      if (!canActNow(500)) return;
      let data = '';
      await fetch(serverBase + '/setRecord?value='+!isRecordAan).catch(() => {});
      isRecordAan=!isRecordAan;
  }

  async function getRecordOn(){
    let recordOn = false;
    await fetch(serverBase + '/getRecordOn')
      .then(res => res.text())
      .then(data => recordOn = data);
    isRecordAan = (recordOn === 'true');
  }

  function checkAtemState(){
    if (!switchers[0]) {
      console.warn('ATEM switcher not connected yet');
      return;
    }
    let audio = switchers[0].getAudio();
    let video = switchers[0].getVideo();
    if(audio[0].on){
        isMutedPC = false;
    } else {
        isMutedPC = true;
    }
    if(audio[8].on){
        isMuted = false;
    } else {
        isMuted = true;
    }
    if(video.ME[0].upstreamKeyState[0]){
        isPipUit = true;
    } else {
        isPipUit = false;
    }
  }


  function getScreenshot() {
       if(!pollingActive){
          clearTimeout(screenshotTimeoutId);
          screenshotTimeoutId = setTimeout(getScreenshot, 1000);
          return;
       }
       if(!isConnected){
          document.querySelector('#program').alt= 'De systemen staan uit om de cameras te bedienen. Schakel deze in.';
          document.querySelector('#program').src= ' ';
          document.querySelector('#program').className = '';
       }else if(!cameraOn){
          document.querySelector('#program').alt= 'De cameras staan uit. Schakel deze in.';
          document.querySelector('#program').src= ' ';
          document.querySelector('#program').className = '';
       }else if(isConnected){
          document.querySelector('#program').src= serverBase + '/screenshot.jpg?v='+new Date().getTime();
          document.querySelector('#program').className = '';
       }else{
          document.querySelector('#program').alt= 'De systemen staan uit om de cameras te bedienen. Schakel deze in.';
          document.querySelector('#program').src= ' ';
          document.querySelector('#program').className = '';
       }
       clearTimeout(screenshotTimeoutId);
       screenshotTimeoutId = setTimeout(getScreenshot, 500);
  }

  // Pause/resume polling when tab visibility changes
  function handleVisibility() {
    pollingActive = !document.hidden;
    if (pollingActive) {
      getStatus();
      getScreenshot();
    }
  }

  async function getStreamerStatus(){
    let streamStatus = '';
    await fetch(serverBase + '/streamStatus')
      .then(res => res.json())
      .then(data => streamStatus = data)
  }

  // Attach visibility listener
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', handleVisibility);
  }

  onDestroy(() => {
    try { if (atemWebSocket) atemWebSocket.close(); } catch (e) {}
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', handleVisibility);
    }
    if (statusTimeoutId) clearTimeout(statusTimeoutId);
    if (screenshotTimeoutId) clearTimeout(screenshotTimeoutId);
  });

  function calculatePreviewClass() {
    presetChunks = 0;
    presetChunks = Array(Math.ceil(presets.length / 4))
     .fill()
     .map((_, index) => index * 4)
     .map(begin => presets.slice(begin, begin + 4));

    let numberOfPresets = 0;
    numberOfPresets = presets.length;

    let presetRows = numberOfPresets / 4;

    if (presetRows <= 1) {
      previewClass = 'preview-1row';
    }else if (presetRows <= 2){
      previewClass = 'preview-2row';
    }else if (presetRows <= 3){
      previewClass = 'preview-3row';
    }else if (presetRows <= 4){
      previewClass = 'preview-4row';
    }else if (presetRows <= 5){
      previewClass = 'preview-5row';
      }
  }


  </script>

<svelte:head>
  <title>Hillegonda stream app</title>
</svelte:head>

<div class:loaded={isLoaded} class:loading={!isLoaded} id="loader-wrapper">
  <div id="loader"></div>

  <div class="loader-section section-left"></div>
  <div class="loader-section section-right"></div>

</div>

<nav class="navbar is-info is-fixed-top" aria-label="main navigation">
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
        <div class="navbar-item has-dropdown">
          <!-- svelte-ignore a11y-missing-attribute -->
          <a class="navbar-link">
            {savedUitzending}
          </a>
          <div class="navbar-dropdown">
            <!-- svelte-ignore a11y-missing-attribute -->
            {#each uitzendingVariant as uitzending}
            <a class="navbar-item" on:click={changeUitzending} on:keypress={changeUitzending}>
                <p>{uitzending}</p>
              </a>
            {/each}
          </div>
        </div>
       <div class="navbar-item">
        <div class="buttons">
          <!-- svelte-ignore a11y-missing-attribute -->
           {#if streaming}
              <a class="button is-danger" on:click={stopStream} on:keypress={stopStream}>
                <span class="icon">
                  <Icon path={mdiAccessPointOff} />
                </span>
                <span>
                  Stop stream
                </span>
              </a>
            {:else if !isConnected}
               <a class="button is-dark" on:click={stopStream} on:keypress={stopStream}>
                  <span class="icon">
                    <Icon path={mdiAccessPointRemove} />
                  </span>
                 <span>
                    Geen connectie
                  </span>
               </a>
            {:else}
              <a class="button is-primary" on:click={startStream} on:keypress={startStream}>
                <span class="icon">
                  <Icon path={mdiAccessPoint} />
                </span>
                <span>
                  Start stream
                </span>
              </a>
            {/if}
            {#if isRecordAan}
              {#if recording}
                <button class="button is-danger" on:click={stopRecord} on:keypress={stopRecord}>
                  <span class="icon">
                    <Icon path={mdiAccessPointOff} />
                  </span>
                  <span>
                    Stop record
                  </span>
                </button>
              {:else if !isConnected}
                 <button class="button is-dark" on:click={stopRecord} on:keypress={stopRecord}>
                    <span class="icon">
                      <Icon path={mdiAccessPointRemove} />
                    </span>
                   <span>
                      Geen connectie
                    </span>
                 </button>
              {:else}
                <button class="button is-primary" on:click={startRecord} on:keypress={startRecord}>
                  <span class="icon">
                    <Icon path={mdiAccessPoint} />
                  </span>
                  <span>
                    Start record
                  </span>
                </button>
              {/if}
             {/if}
          <!-- svelte-ignore a11y-missing-attribute -->
        </div>
      </div>
    </div>
  </div>
</nav>

<section class="section mt-5">
  <div class="container is-fluid ">
      {#each presetChunks as chunk}
        <div class="tile is-ancestor">
          {#each chunk as preset}
            <div class="tile is-parent p-1">
              <!-- svelte-ignore a11y-missing-attribute -->
                {#if savedPreset == preset}
                  <a on:click={setPreset} on:keypress={setPreset} class="tile is-child is-primary notification">
                        <p class="subtitle has-text-centered is-size-7-mobile">{preset}</p>
                  </a>
                {:else if !isConnected}
                  <a on:click={setPreset} on:keypress={setPreset} class="tile is-child is-dark notification">
                    <p class="subtitle has-text-centered is-size-7-mobile">{preset}</p>
                  </a>
                {:else}
                  <a on:click={setPreset} on:keypress={setPreset} class="tile is-child is-info notification">
                    <p class="subtitle has-text-centered is-size-7-mobile">{preset}</p>
                  </a>
                {/if}
            </div>
          {/each}
        </div>
      {/each}
      <div class="columns is-centered is-vcentered has-text-centered mt-1">
        <div class="column">
          <img id="program" alt="Program" class="is-hidden"/>
        </div>
      </div>
  </div>
</section>
<nav class="navbar is-info is-fixed-bottom" aria-label="main navigation">
  <div class="navbar-item">
    <!-- svelte-ignore a11y-missing-attribute -->
    <a class:is-danger={isMutedPC} class:is-primary={!isMutedPC} class="button" on:click={toggleMutePC} on:keypress={toggleMutePC} title="Toggle Mute PC">
      <span class="icon">
        {#if isMutedPC}
        <Icon path={mdiHeadphonesOff} />
        {:else}
        <Icon path={mdiHeadphones} />
        {/if}
      </span>
    </a>
  </div>
  <div class="navbar-item">
    <!-- svelte-ignore a11y-missing-attribute -->
    <a class:is-danger={isPipUit} class:is-primary={!isPipUit} class="button" on:click={togglePip} on:keypress={togglePip} title="Toggle Mute PC">
      <span class="icon">
        <Icon path={mdiPictureInPictureTopRight} />
      </span>
    </a>
  </div>
  <div class="navbar-item">
    <!-- svelte-ignore a11y-missing-attribute -->
    <a class:is-dark={!isRecordAan} class:is-danger={isRecordAan} class="button" disabled={streaming || null} on:click={toggleRecord} on:keypress={toggleRecord} title="Toggle Record Mode">
      <span class="icon">
        <Icon path={mdiRecordRec} />
      </span>
    </a>
  </div>

  <div class="navbar-start is-justify-content-center is-flex-grow-1">
    <div class="navbar-item">
      <!-- svelte-ignore a11y-missing-attribute -->
      <a class:is-danger={isMuted} class:is-primary={!isMuted} class="button" on:click={toggleMute} on:keypress={toggleMute} title="Toggle Mute Audio Systeem">
          <span class="icon">
            {#if isMuted}
              <Icon path={mdiMicrophoneOff} />
            {:else}
              <Icon path={mdiMicrophone} />
            {/if}
          </span>
      </a>
    </div>
  </div>
  {#if cameraError}
  <div class="navbar-item">
    Een van de camara's is niet bereikbaar
  </div>
  {/if} 
  <div class="navbar-item">
    <!-- svelte-ignore a11y-missing-attribute -->
    <a class:is-danger={!cameraOn} class:is-primary={cameraOn && !cameraError} class:is-warning={cameraError} class="button" on:click={changePowerModeCameras} on:keypress={changePowerModeCameras} title="Toggle Camera">
      <span class="icon">
          {#if cameraOn}
            <Icon path={mdiCamera} />
          {:else}
            <Icon path={mdiCameraOff} />
          {/if}
        </span>
    </a>
  </div>
  <div class="navbar-item">
    <a class="button is-light" href="/admin.html" target="_blank" title="Open Admin Panel">
      <span class="icon">
        <Icon path={mdiCog} />
      </span>
      <span>
        Admin
      </span>
    </a>
  </div>
</nav>
{#if toast}
  <div class="toast">{toast}</div>
{/if}
