/**
 * Mock implementations for ATEM and Streamer for testing
 */

class MockATEM {
  constructor() {
    this.state = {
      device: 0,
      video: {
        programInput: 1,
        previewInput: 2,
        transitionPreview: false,
        transitionPosition: 0,
        transitionType: 0
      },
      audio: {
        master: { volume: 0.8 }
      },
      upstreamKeys: [
        { on: false, next: false, background: false },
        { on: false, next: false, background: false },
        { on: false, next: false, background: false },
        { on: false, next: false, background: false }
      ],
      downstreamKeys: [
        { on: false, tie: false },
        { on: false, tie: false }
      ],
      macros: {
        running: false,
        macroIndex: 0
      }
    };
    this.event = {
      setMaxListeners: () => {},
      emit: () => {}
    };
    this.device = 0;
    this.connected = false;
    this.eventHandlers = {};
  }

  connect(addr, port) {
    console.log(`[MOCK] ATEM connecting to ${addr}:${port}`);
    this.connected = true;
    // Simulate connection after a short delay
    setTimeout(() => {
      this.emit('connect', null);
    }, 100);
  }

  on(event, handler) {
    this.eventHandlers[event] = handler;
  }

  emit(event, data) {
    if (this.eventHandlers[event]) {
      this.eventHandlers[event](null, data);
    }
  }

  // ATEM Methods
  changePreviewInput(input) {
    console.log(`[MOCK] ATEM changePreviewInput: ${input}`);
    this.state.video.previewInput = input;
    this.emit('stateChanged', this.state);
  }

  changeProgramInput(input) {
    console.log(`[MOCK] ATEM changeProgramInput: ${input}`);
    this.state.video.programInput = input;
    this.emit('stateChanged', this.state);
  }

  autoTransition() {
    console.log(`[MOCK] ATEM autoTransition`);
    // Simulate transition
    this.state.video.programInput = this.state.video.previewInput;
    this.emit('stateChanged', this.state);
  }

  cutTransition() {
    console.log(`[MOCK] ATEM cutTransition`);
    this.state.video.programInput = this.state.video.previewInput;
    this.emit('stateChanged', this.state);
  }

  fadeToBlack() {
    console.log(`[MOCK] ATEM fadeToBlack`);
    this.state.video.programInput = 0; // Black
    this.emit('stateChanged', this.state);
  }

  changeUpstreamKeyState(number, state) {
    console.log(`[MOCK] ATEM changeUpstreamKeyState: ${number} = ${state}`);
    if (this.state.upstreamKeys[number]) {
      this.state.upstreamKeys[number].on = state;
      this.emit('stateChanged', this.state);
    }
  }

  changeUpstreamKeyNextState(number, state) {
    console.log(`[MOCK] ATEM changeUpstreamKeyNextState: ${number} = ${state}`);
    if (this.state.upstreamKeys[number]) {
      this.state.upstreamKeys[number].next = state;
      this.emit('stateChanged', this.state);
    }
  }

  changeDownstreamKeyOn(number, state) {
    console.log(`[MOCK] ATEM changeDownstreamKeyOn: ${number} = ${state}`);
    if (this.state.downstreamKeys[number]) {
      this.state.downstreamKeys[number].on = state;
      this.emit('stateChanged', this.state);
    }
  }

  changeDownstreamKeyTie(number, state) {
    console.log(`[MOCK] ATEM changeDownstreamKeyTie: ${number} = ${state}`);
    if (this.state.downstreamKeys[number]) {
      this.state.downstreamKeys[number].tie = state;
      this.emit('stateChanged', this.state);
    }
  }

  changeTransitionPreview(state, me) {
    console.log(`[MOCK] ATEM changeTransitionPreview: ${state}, me: ${me}`);
    this.state.video.transitionPreview = state;
    this.emit('stateChanged', this.state);
  }

  changeTransitionPosition(position) {
    console.log(`[MOCK] ATEM changeTransitionPosition: ${position}`);
    this.state.video.transitionPosition = position;
    this.emit('stateChanged', this.state);
  }

  changeTransitionType(type) {
    console.log(`[MOCK] ATEM changeTransitionType: ${type}`);
    this.state.video.transitionType = type;
    this.emit('stateChanged', this.state);
  }

  changeUpstreamKeyNextBackground(state) {
    console.log(`[MOCK] ATEM changeUpstreamKeyNextBackground: ${state}`);
    this.state.upstreamKeys.forEach(key => {
      key.background = state;
    });
    this.emit('stateChanged', this.state);
  }

  autoDownstreamKey(number) {
    console.log(`[MOCK] ATEM autoDownstreamKey: ${number}`);
    if (this.state.downstreamKeys[number]) {
      this.state.downstreamKeys[number].on = !this.state.downstreamKeys[number].on;
      this.emit('stateChanged', this.state);
    }
  }

  runMacro(number) {
    console.log(`[MOCK] ATEM runMacro: ${number}`);
    this.state.macros.running = true;
    this.state.macros.macroIndex = number;
    this.emit('stateChanged', this.state);
    // Simulate macro completion
    setTimeout(() => {
      this.state.macros.running = false;
      this.emit('stateChanged', this.state);
    }, 1000);
  }
}

class MockHttpUtils {
  constructor() {
    // Track camera states for realistic mocking
    this.cameraStates = new Map();
    this.streamingState = false; // Track streaming state
    
    this.mockResponses = {
      // Camera responses
      cameraStatus: {
        data: { POWERMODE: "ON" },
        statusCode: 200
      },
      cameraPowerOn: {
        data: { result: 0 },
        statusCode: 200
      },
      cameraPowerOff: {
        data: { result: 0 },
        statusCode: 200
      },
      // Streamer responses - status will be generated dynamically
      streamerLogin: {
        data: JSON.stringify({ result: 0 }),
        statusCode: 200,
        headers: {
          'set-cookie': ['session=abc123; Path=/']
        }
      },
      streamerStart: {
        data: { result: 0 },
        statusCode: 200
      },
      streamerStop: {
        data: { result: 0 },
        statusCode: 200
      },
      streamerFiles: {
        data: JSON.stringify({
          result: 0,
          files: [
            { name: "test1.mp4", size: 1000000, date: "2023-01-01" },
            { name: "test2.mp4", size: 2000000, date: "2023-01-02" }
          ]
        }),
        statusCode: 200
      }
    };
  }

  getStreamerStatus() {
    const status = {
      data: {
        result: 0,
        'live-status': {
          status: this.streamingState ? 1 : 0, // 1 = streaming, 0 = not streaming
          bitrate: 2500,
          resolution: "1920x1080",
          fps: 30
        },
        'rec-status': {
          status: 0,
          duration: 0,
          space: 1000000000
        },
        'cur-status': this.streamingState ? 4 : 0 // 4 = statusLiving bit (0x04)
      },
      statusCode: 200
    };
    console.log(`[MOCK] getStreamerStatus - streamingState: ${this.streamingState}, cur-status: ${status.data['cur-status']}`);
    return status;
  }

  async get(url, options = {}) {
    console.log(`[MOCK] HTTP GET: ${url}`);
    
    // Simulate network delay
    await new Promise(resolve => setTimeout(resolve, 50 + Math.random() * 100));
    
    // Camera status check
    if (url.includes('/powerModeInq')) {
      const cameraIp = this.extractCameraIp(url);
      const currentState = this.cameraStates.get(cameraIp) || 'ON';
      return {
        data: { POWERMODE: currentState },
        statusCode: 200
      };
    }
    
    // Streamer status
    if (url.includes('/usapi?method=get-status')) {
      return this.getStreamerStatus();
    }
    
    // Streamer actions (GET)
    if (url.includes('/usapi?method=start-live')) {
      this.streamingState = true;
      console.log(`[MOCK] Streamer started streaming (GET) - streamingState: ${this.streamingState}`);
      return this.mockResponses.streamerStart;
    }
    if (url.includes('/usapi?method=stop-live')) {
      this.streamingState = false;
      console.log(`[MOCK] Streamer stopped streaming (GET) - streamingState: ${this.streamingState}`);
      return this.mockResponses.streamerStop;
    }
    
    // Streamer login
    if (url.includes('/usapi?method=login')) {
      return this.mockResponses.streamerLogin;
    }
    
    // Streamer files
    if (url.includes('/usapi?method=get-media-files')) {
      return this.mockResponses.streamerFiles;
    }
    
    // Streamer main page
    if (url.includes('/usapi') || url.endsWith('/')) {
      return this.getStreamerStatus();
    }
    
    // Default response
    return {
      data: { result: 0 },
      statusCode: 200
    };
  }

  async post(url, data, options = {}) {
    console.log(`[MOCK] HTTP POST: ${url}`);
    console.log(`[MOCK] Data:`, data);
    
    // Simulate network delay
    await new Promise(resolve => setTimeout(resolve, 50 + Math.random() * 100));
    
    // Camera power actions
    if (url.includes('/cgi-bin/lums_configuration.cgi')) {
      const cameraIp = this.extractCameraIp(url);
      const powerMode = this.extractPowerMode(data);
      
      // Update camera state
      this.cameraStates.set(cameraIp, powerMode === '1' ? 'ON' : 'OFF');
      console.log(`[MOCK] Camera ${cameraIp} power set to: ${powerMode === '1' ? 'ON' : 'OFF'}`);
      
      return {
        data: { result: 0 },
        statusCode: 200
      };
    }
    
    // Streamer actions
    if (url.includes('/usapi?method=start-live')) {
      this.streamingState = true;
      console.log(`[MOCK] Streamer started streaming - streamingState: ${this.streamingState}`);
      return this.mockResponses.streamerStart;
    }
    if (url.includes('/usapi?method=stop-live')) {
      this.streamingState = false;
      console.log(`[MOCK] Streamer stopped streaming - streamingState: ${this.streamingState}`);
      return this.mockResponses.streamerStop;
    }
    if (url.includes('/usapi?method=start-rec')) {
      return this.mockResponses.streamerStart;
    }
    if (url.includes('/usapi?method=stop-rec')) {
      return this.mockResponses.streamerStop;
    }
    
    return this.mockResponses.streamerStart;
  }

  // Helper methods for camera mocking
  extractCameraIp(url) {
    const match = url.match(/http:\/\/([^\/]+)/);
    return match ? match[1] : 'unknown';
  }

  extractPowerMode(data) {
    try {
      const parsed = JSON.parse(data);
      return parsed.powermode || '1';
    } catch (e) {
      // Fallback: look for powermode in the string
      const match = data.match(/"powermode":\s*"([^"]+)"/);
      return match ? match[1] : '1';
    }
  }

  // Method to get current camera states (for debugging)
  getCameraStates() {
    return Object.fromEntries(this.cameraStates);
  }

  // Method to reset all camera states
  resetCameraStates() {
    this.cameraStates.clear();
  }
}

// Mock state variables
const mockState = {
  preset: 'default',
  uitzending: 'avond',
  streamStatus: 'stopped',
  liveStatus: '{"status":0}',
  statusCameras: [],
  camerasStatus: 'ON',
  recordOn: false,
  streaming: false,
  recording: false
};

module.exports = {
  MockATEM,
  MockHttpUtils,
  mockState
};
