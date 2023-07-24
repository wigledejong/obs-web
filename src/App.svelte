<script>

  // Imports
  import { onMount } from 'svelte';
  import './style.scss';
  import { mdiCameraOff, mdiCamera, mdiMicrophoneOff, mdiMicrophone, mdiAccessPoint, mdiAccessPointOff, mdiHeadphonesOff,
    mdiAccessPointRemove, mdiHeadphones, mdiPictureInPictureTopRight} from '@mdi/js';
  import Icon from 'mdi-svelte';

  import { ATEM } from "./atem.js";

  onMount(async () => {
    await loadConfig();
    await statusCameras();
    await loginStreamer();
    await streamStatus();
    await getSavedUitzending();
    await getSavedPreset();
    await checkSession();
    await connectAtem();
    await getScreenshot();
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
    isConnected,
    cameraOn,
    datum,
    previewClass,
    streaming,
    isLoaded = false;
  let isMutedPC = true;
  let switchers = [];
  let avondProfiel = [];
  let ochtendProfiel = [];
  let cameras = [];
  let presets = [];
  let presetsConfig = [];
  let uitzendingVariant = [];
  let presetUitzending = [];
  let intervalID = 0;
  let savedPreset,
    savedUitzending,
    programChannel,
    beginDienst= '';
  let atemWebSocket;
  let appConfig;
  let presetChunks;

  $: presetChunks = Array(Math.ceil(presets.length / 4))
     .fill()
     .map((_, index) => index * 4)
     .map(begin => presets.slice(begin, begin + 4));

  async function connectAtem() {
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

    atemWebSocket.addEventListener("message", async function(event) {
      let data = JSON.parse(event.data);
      let device = data.device || 0;
      switch (data.method) {
        case 'connect':
          switchers[device].connected = true;
          programChannel = switchers[0].returnProgramChannel();

          break;
        case 'disconnect':
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
            intervalID = setTimeout(connectAtem, (10*6000));
          }
          await checkAtemState();
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

  async function loadConfig(){
    let url  = window.location + "";
    url = url.slice(0, url.lastIndexOf("/"));
    url = url.slice(0, url.lastIndexOf(":"));
    await fetch(url+':8081/config')
      .then(res => res.json())
      .then(data => appConfig = data)
    cameras = appConfig.cameras;
    presetsConfig = [];
    presetUitzending = [];
    presetsConfig =  appConfig.presets;
    avondProfiel = appConfig.avondProfiel;
    ochtendProfiel = appConfig.ochtendProfiel;
    uitzendingVariant = appConfig.uitzendingVariant;
    presetUitzending = appConfig.presetUitzending;
  }

  async function statusCameras(){
    let cameraOnBool = false;
    let cameraStatus = '';
    await fetch('http://'+ appConfig.atemServer +'/getCameraStatus')
      .then(res => res.json())
      .then(data => cameraStatus = data)
    for (let key in cameraStatus){
      let camera = cameraStatus[key];
      if (camera.status == "ON") {
          cameraOnBool = true;
      }
    }
    cameraOn = cameraOnBool;
  }

  async function loginStreamer(){
    console.log("Login Streamer");
    await fetch('http://'+ appConfig.atemServer +'/loginStreamer')
    .then((res) => {
      if (res.statusText == "OK"){
        isConnected = true;
      }
    })
    .catch((err) => {
      isConnected = false;

    });
    if(!isConnected){
      console.log("Niet geconnect met streamer");
      setTimeout(loginStreamer, 1000);
    }
  }

  async function startStream(){
    if (confirm("Weet je zeker dat je de stream wilt starten?") == true) {
      isLoaded = false;
      while(!streaming) {
        await fetch('http://'+ appConfig.atemServer +'/startStreamen');
        await streamStatus();
      }
      isLoaded = true;
    }
  }

  async function stopStream(){
    if (confirm("Weet je zeker dat je de stream wilt stoppen?") == true) {
      isLoaded = false;
      while(streaming) {
        await fetch('http://' + appConfig.atemServer + '/stopStreamen');
        await streamStatus();
      }
      isLoaded = true;
    }
  }

  async function streamStatus() {
   await statusCameras();
   if(isConnected){
    await fetch('http://'+ appConfig.atemServer +'/streamStatus')
      .then(res => res.json())
      .then(data => streaming = data)
      .catch(err => {
        isConnected = false;
        loginStreamer();
      });
    setTimeout(streamStatus, 1000);
   } else {
      streaming = false;
   }
  }


  async function checkSession(){
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
    isLoaded = false;
    let nextPreset = e.currentTarget.textContent;
    let preset = presetsConfig[nextPreset];
    if(preset != null){
      let camera = cameras[preset.camera];

      if(nextPreset == "Collecte" || nextPreset == "Begin dienst"){
        await changeAtemChannel(camera.atemChannel);
        await setCameraPreset(presetsConfig["StartScene"]);
        await runMacro(4);
      }else{
        if (preset.preset){
          await setCameraPreset(preset);
        }
        await changeAtemChannel(camera.atemChannel);
        if(nextPreset == "Predikant" || nextPreset == "Afkondigingen" || nextPreset == "Spreker"){
          await runMacro(18);
        } else{
          await runMacro(16);
        }
      }

      const options = {
        method: 'POST',
        headers: new Headers({'content-type': 'application/json'}),
        mode: 'no-cors',
        body: nextPreset
      };

      await fetch('http://'+ appConfig.atemServer +'/savePreset', options);
      getSavedPreset();

    } else {
      alert("De scene: "+nextPreset+" is onbekend");
    }
    isLoaded = true;
  }

  async function changeAtemChannel(atemChannel){
    switchers[0].changePreviewInput(atemChannel);
    switchers[0].cutTransition();
  }

  async function changeUitzending(e){
    isLoaded = false;
    let newUitzending = e.currentTarget.textContent.trim();
    const options = {
        method: 'POST',
        headers: new Headers({'content-type': 'application/json'}),
        mode: 'no-cors',
        body: newUitzending
      };

    await fetch('http://'+ appConfig.atemServer +'/saveUitzending', options);
    getSavedUitzending();
    isLoaded = true;
  }

  async function getSavedPreset(){
    let preset = '';
    await fetch('http://'+ appConfig.atemServer +'/getPreset')
      .then(res => res.text())
      .then(data => preset = data);
    savedPreset = preset;
  }

  async function getSavedUitzending(){
    let uitzending = '';
    presets = [];
    await fetch('http://'+ appConfig.atemServer +'/getUitzending')
      .then(res => res.text())
      .then(data => uitzending = data);
    savedUitzending = uitzending;
    presetUitzending[savedUitzending].forEach(item => presets.push(item));
    console.log('Presets: '+presets);
    await calculatePreviewClass();
  }

  async function runMacro(macro) {
    switchers[0].runMacro(macro);
  }

  async function setCameraPreset(preset){
    let camera = cameras[preset.camera];
    console.log(preset);
    let presetUrl =  "http://"+ camera.ip +"/cgi-bin/lums_configuration.cgi";
    await sendCommandToLumens(presetUrl, JSON.stringify({"cmd":"campresetrecall", "memnum": preset.preset}), camera);
  }

  async function changePowerModeCameras(){
    isLoaded = false;
    let cameraStatus = '';
    if (cameraOn) {
      await fetch('http://'+ appConfig.atemServer +'/camerasOff')
        .then(res => res.json())
        .then(data => cameraStatus = data)
      console.log(cameraStatus);
    } else {
      await fetch('http://'+ appConfig.atemServer +'/camerasOn')
        .then(res => res.json())
        .then(data => cameraStatus = data)
      console.log(cameraStatus);
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

  async function toggleMute() {
    let audio = switchers[0].getAudio();
    if(audio[8].on){
        switchers[0].runMacro(0);
        isMuted = true;
    } else {
      switchers[0].runMacro(2);
        isMuted = false;
    }
  }

  async function toggleMutePC() {
    let audio = switchers[0].getAudio();
    if(audio[0].on){
        switchers[0].runMacro(3);
        isMutedPC = true;
    } else {
      switchers[0].runMacro(1);
        isMutedPC = false;
    }
  }

  async function togglePip() {
      let video = switchers[0].getVideo();
      if(video.ME[0].upstreamKeyState[0]){
          switchers[0].runMacro(16);
          isPipUit = true;
      } else {
        switchers[0].runMacro(4);
          isPipUit = false;
      }
    }


 async function checkAtemState(){
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
        isPipUit = false;
    } else {
        isPipUit = true;
    }
 }


  async function getScreenshot() {
       if(!isConnected){
          document.querySelector('#program').alt= 'De systemen staan uit om de cameras te bedienen. Schakel deze in.';
          document.querySelector('#program').src= ' ';
          document.querySelector('#program').className = '';
       }else if(!cameraOn){
          document.querySelector('#program').alt= 'De cameras staan uit. Schakel deze in.';
          document.querySelector('#program').src= ' ';
          document.querySelector('#program').className = '';
       }else if(isConnected){
          document.querySelector('#program').src= 'http://'+ appConfig.atemServer +'/screenshot.jpg?v='+new Date().getTime();
          document.querySelector('#program').className = '';
       }else{
          document.querySelector('#program').alt= 'De systemen staan uit om de cameras te bedienen. Schakel deze in.';
          document.querySelector('#program').src= ' ';
          document.querySelector('#program').className = '';
       }
       setTimeout(getScreenshot, 500);
  }

  async function getStreamerStatus(){
    let streamStatus = '';
    await fetch('http://'+ appConfig.atemServer +'/streamStatus')
      .then(res => res.json())
      .then(data => streamStatus = data)
  }

  async function calculatePreviewClass() {
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
        <div class="navbar-item has-dropdown">
          <!-- svelte-ignore a11y-missing-attribute -->
          <a class="navbar-link">
            {savedUitzending}
          </a>
          <div class="navbar-dropdown">
            <!-- svelte-ignore a11y-missing-attribute -->
            {#each uitzendingVariant as uitzending}
            <a class="navbar-item" on:click={changeUitzending}>
                <p>{uitzending}</p>
              </a>
            {/each}
          </div>
        </div>
       <div class="navbar-item">
        <div class="buttons">
          <!-- svelte-ignore a11y-missing-attribute -->
           {#if streaming}
              <a class="button is-danger" on:click={stopStream}>
                <span class="icon">
                  <Icon path={mdiAccessPointOff} />
                </span>
                <span>
                  Stop stream
                </span>
              </a>
            {:else if !isConnected}
               <a class="button is-dark" on:click={stopStream}>
                  <span class="icon">
                    <Icon path={mdiAccessPointRemove} />
                  </span>
                 <span>
                    Geen connectie
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
                  <a on:click={setPreset} class="tile is-child is-primary notification">
                        <p class="subtitle has-text-centered is-size-7-mobile">{preset}</p>
                  </a>
                {:else if !isConnected}
                  <a on:click={setPreset} class="tile is-child is-dark notification">
                    <p class="subtitle has-text-centered is-size-7-mobile">{preset}</p>
                  </a>
                {:else}
                  <a on:click={setPreset} class="tile is-child is-info notification">
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
<nav class="navbar is-info is-fixed-bottom" role="navigation" aria-label="main navigation">
  <div class="navbar-item">
    <!-- svelte-ignore a11y-missing-attribute -->
    <a class:is-danger={isMutedPC} class:is-primary={!isMutedPC} class="button" on:click={toggleMutePC} title="Toggle Mute PC">
      <span class="icon">
        {#if isMutedPC}
        <Icon path={mdiHeadphonesOff} />
        {:else}
        <Icon path={mdiHeadphones} />
        {/if}
      </span>
    </a>
  </div>  <div class="navbar-item">
    <!-- svelte-ignore a11y-missing-attribute -->
    <a class:is-danger={isPipUit} class:is-primary={!isPipUit} class="button" on:click={togglePip} title="Toggle Mute PC">
      <span class="icon">
        <Icon path={mdiPictureInPictureTopRight} />
      </span>
    </a>
  </div>

  <div class="navbar-start is-justify-content-center is-flex-grow-1">
    <div class="navbar-item">
      <!-- svelte-ignore a11y-missing-attribute -->
      <a class:is-danger={isMuted} class:is-primary={!isMuted} class="button" on:click={toggleMute} title="Toggle Mute Audio Systeem">
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
  <div class="navbar-item">
    <!-- svelte-ignore a11y-missing-attribute -->
    <a class:is-danger={!cameraOn} class:is-primary={cameraOn} class="button" on:click={changePowerModeCameras} title="Toggle Camera">
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
