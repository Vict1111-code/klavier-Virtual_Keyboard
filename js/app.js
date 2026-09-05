(function(){
  "use strict";

  const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
  const BLACK_SET = new Set([1,3,6,8,10]);
  const SCALE_DEFS = {
    none:null, major:[0,2,4,5,7,9,11], minor:[0,2,3,5,7,8,10],
    majpent:[0,2,4,7,9], minpent:[0,3,5,7,10], blues:[0,3,5,6,7,10]
  };
  const TONE_LIST = [
    {value:'grand', label:'Grand Piano'}, {value:'epiano', label:'Electric Piano'},
    {value:'organ', label:'Organ'}, {value:'jazzorgan', label:'Jazz Organ'},
    {value:'strings', label:'Strings'}, {value:'brass', label:'Brass'},
    {value:'bass', label:'Bass'}, {value:'choir', label:'Choir / Pad'},
    {value:'musicbox', label:'Music Box'}, {value:'synth', label:'Synth Lead'},
  ];

  const LAYOUT = {
    label:'Two Octaves', octaveMin:1, octaveMax:5, defaultOctave:3,
    keys:[
      // Octave 1 — left hand — home row (white) + row above (black), 12 keys
      {semitone:0, code:'KeyA', hand:'l'},{semitone:1, code:'KeyW', hand:'l'},{semitone:2, code:'KeyS', hand:'l'},
      {semitone:3, code:'KeyE', hand:'l'},{semitone:4, code:'KeyD', hand:'l'},{semitone:5, code:'KeyF', hand:'l'},
      {semitone:6, code:'KeyT', hand:'l'},{semitone:7, code:'KeyG', hand:'l'},{semitone:8, code:'KeyY', hand:'l'},
      {semitone:9, code:'KeyH', hand:'l'},{semitone:10,code:'KeyU', hand:'l'},{semitone:11,code:'KeyJ', hand:'l'},
      // Octave 2 — right hand — K L ; ' \ M , (white) + I O P [ ] (black), 12 keys
      {semitone:12,code:'KeyK',        hand:'r'},{semitone:13,code:'KeyI',         hand:'r'},{semitone:14,code:'KeyL',hand:'r'},
      {semitone:15,code:'KeyO',        hand:'r'},{semitone:16,code:'Semicolon',    hand:'r'},{semitone:17,code:'Quote',hand:'r'},
      {semitone:18,code:'KeyP',        hand:'r'},{semitone:19,code:'Backslash',    hand:'r'},{semitone:20,code:'BracketLeft',hand:'r'},
      {semitone:21,code:'KeyM',        hand:'r'},{semitone:22,code:'BracketRight', hand:'r'},{semitone:23,code:'Comma',hand:'r'},
    ]
  };
  const CODE_LABEL = {
    KeyA:'A',KeyS:'S',KeyD:'D',KeyF:'F',KeyG:'G',KeyH:'H',KeyJ:'J',KeyW:'W',KeyE:'E',KeyT:'T',KeyY:'Y',KeyU:'U',
    KeyK:'K',KeyL:'L',Semicolon:';',Quote:"'",Backslash:'\\',KeyM:'M',KeyI:'I',KeyO:'O',KeyP:'P',BracketLeft:'[',BracketRight:']',Comma:','
  };

  // ---------- State ----------
  let layout = LAYOUT, baseOctave = layout.defaultOctave;
  let currentTone = 'grand', transposeSemitones = 0, sustainOn = false;
  let dualOn = false, dualVoice = 'strings';
  let splitOn = false, splitVoice = 'bass', splitPointMidi = 60;
  let customEnvelope = false, envAttack=0.02, envDecay=0.2, envSustain=0.5, envRelease=0.5;
  let scaleType = 'none', scaleRoot = 0;
  let vizEnabled = true;
  const pressedCodes = new Set();
  const activeVoices = new Map(); // id -> { voices, sustained, semitone, baseMidi }
  let CODE_TO_SEMITONE = {};
  const capturesList = []; // {events:[], startAudioTime}

  let simpleRecording = false, simpleCapture = null, recordedEvents = [];
  let isPlaying = false, playTimers = [];

  // ---------- Audio setup ----------
  let audioCtx=null, masterGain, compressor, pianoWave, drumGain, noiseBuffer;
  let distDry, distWet, distShaper, chorusDry, chorusWet, chorusDelay, chorusLFO, chorusLFOGain;
  let delayDry, delayWet, delayNode, delayFeedbackGain;
  let dryGain, wetGain, convolver;

  function makeDistortionCurve(amount){
    const n = 4096; const curve = new Float32Array(n); const deg = Math.PI/180;
    for(let i=0;i<n;i++){ const x = i*2/n-1; curve[i] = (3+amount)*x*20*deg/(Math.PI+amount*Math.abs(x)); }
    return curve;
  }

  function initAudio(){
    if(audioCtx) return;
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();

    masterGain = audioCtx.createGain();
    masterGain.gain.value = parseFloat(document.getElementById('volSlider').value)/100;

    // --- Effects chain: masterGain -> distortion -> chorus -> delay -> compressor -> [dry/reverb] -> destination
    distDry = audioCtx.createGain(); distDry.gain.value = 1;
    distWet = audioCtx.createGain(); distWet.gain.value = 0;
    distShaper = audioCtx.createWaveShaper();
    distShaper.curve = makeDistortionCurve(45);
    distShaper.oversample = '4x';
    const distBus = audioCtx.createGain();
    masterGain.connect(distDry); masterGain.connect(distShaper); distShaper.connect(distWet);
    distDry.connect(distBus); distWet.connect(distBus);

    chorusDry = audioCtx.createGain(); chorusDry.gain.value = 1;
    chorusWet = audioCtx.createGain(); chorusWet.gain.value = 0;
    chorusDelay = audioCtx.createDelay(0.05); chorusDelay.delayTime.value = 0.015;
    chorusLFO = audioCtx.createOscillator(); chorusLFO.type='sine'; chorusLFO.frequency.value = 0.6;
    chorusLFOGain = audioCtx.createGain(); chorusLFOGain.gain.value = 0.004;
    chorusLFO.connect(chorusLFOGain).connect(chorusDelay.delayTime);
    chorusLFO.start();
    const chorusBus = audioCtx.createGain();
    distBus.connect(chorusDry); distBus.connect(chorusDelay); chorusDelay.connect(chorusWet);
    chorusDry.connect(chorusBus); chorusWet.connect(chorusBus);

    delayDry = audioCtx.createGain(); delayDry.gain.value = 1;
    delayWet = audioCtx.createGain(); delayWet.gain.value = 0;
    delayNode = audioCtx.createDelay(2.0); delayNode.delayTime.value = 0.35;
    delayFeedbackGain = audioCtx.createGain(); delayFeedbackGain.gain.value = 0.3;
    const delayBus = audioCtx.createGain();
    chorusBus.connect(delayDry);
    chorusBus.connect(delayNode); delayNode.connect(delayFeedbackGain); delayFeedbackGain.connect(delayNode);
    delayNode.connect(delayWet);
    delayDry.connect(delayBus); delayWet.connect(delayBus);

    compressor = audioCtx.createDynamicsCompressor();
    compressor.threshold.value=-12; compressor.knee.value=20; compressor.ratio.value=4;
    compressor.attack.value=0.003; compressor.release.value=0.25;
    delayBus.connect(compressor);

    dryGain = audioCtx.createGain(); dryGain.gain.value = 1;
    wetGain = audioCtx.createGain(); wetGain.gain.value = (parseFloat(document.getElementById('reverbSlider').value)/100)*0.6;
    convolver = audioCtx.createConvolver();
    try{ convolver.buffer = buildImpulseResponse(2.2,3.0); }catch(err){ console.warn('Reverb build failed', err); }
    compressor.connect(dryGain).connect(audioCtx.destination);
    if(convolver.buffer){ compressor.connect(convolver).connect(wetGain).connect(audioCtx.destination); }

    drumGain = audioCtx.createGain(); drumGain.gain.value = 0.5; drumGain.connect(audioCtx.destination);

    const noiseLen = audioCtx.sampleRate*1.0;
    noiseBuffer = audioCtx.createBuffer(1, noiseLen, audioCtx.sampleRate);
    const nd = noiseBuffer.getChannelData(0);
    for(let i=0;i<noiseLen;i++) nd[i] = Math.random()*2-1;

    const harmonics=12; const real=new Float32Array(harmonics); const imag=new Float32Array(harmonics);
    const amps=[0,1,0.55,0.34,0.27,0.17,0.13,0.09,0.07,0.05,0.035,0.025];
    for(let i=0;i<harmonics;i++) imag[i]=amps[i]||0;
    try{ pianoWave = audioCtx.createPeriodicWave(real, imag, {disableNormalization:false}); }
    catch(err){ pianoWave = null; }
  }

  function buildImpulseResponse(duration, decay){
    const rate = audioCtx.sampleRate; const length = Math.floor(rate*duration);
    const buffer = audioCtx.createBuffer(2, length, rate);
    for(let ch=0; ch<2; ch++){
      const data = buffer.getChannelData(ch);
      for(let i=0;i<length;i++) data[i] = (Math.random()*2-1) * Math.pow(1-i/length, decay);
    }
    return buffer;
  }

  function freqFromMidi(midi){ return 440*Math.pow(2,(midi-69)/12); }

  // ---------- Voice synthesis ----------
  function createVoice(freq, tone, velocity){
    const now = audioCtx.currentTime;
    const out = audioCtx.createGain(); out.gain.value = 0; out.connect(masterGain);
    const stopNodes = [];
    let attack=0.006, decay=0.3, sustainLevel=0.35, release=0.9;

    function addAmpLFO(rate, depth){
      const lfo=audioCtx.createOscillator(); lfo.type='sine'; lfo.frequency.value=rate;
      const lg=audioCtx.createGain(); lg.gain.value=depth;
      lfo.connect(lg).connect(out.gain); lfo.start(now); stopNodes.push(lfo);
    }

    if(tone==='grand'){
      const o1=audioCtx.createOscillator();
      if(pianoWave){ o1.setPeriodicWave(pianoWave); } else { o1.type='triangle'; }
      o1.frequency.value=freq;
      const o2=audioCtx.createOscillator(); o2.type='triangle'; o2.frequency.value=freq*1.0035;
      const o2g=audioCtx.createGain(); o2g.gain.value=0.16;
      const filter=audioCtx.createBiquadFilter(); filter.type='lowpass';
      filter.frequency.value=Math.min(9500,freq*9+1400); filter.Q.value=0.6;
      o1.connect(filter); o2.connect(o2g).connect(filter); filter.connect(out);
      attack=0.005; decay=0.4; sustainLevel=0.32; release=1.0;
      o1.start(now); o2.start(now); stopNodes.push(o1,o2);

    } else if(tone==='epiano'){
      const o1=audioCtx.createOscillator(); o1.type='sine'; o1.frequency.value=freq;
      const o2=audioCtx.createOscillator(); o2.type='sine'; o2.frequency.value=freq*2.005;
      const o2g=audioCtx.createGain(); o2g.gain.value=0.22;
      const filter=audioCtx.createBiquadFilter(); filter.type='lowpass'; filter.frequency.value=3200; filter.Q.value=0.4;
      o1.connect(filter); o2.connect(o2g).connect(filter); filter.connect(out);
      attack=0.003; decay=0.5; sustainLevel=0.22; release=1.3;
      o1.start(now); o2.start(now); stopNodes.push(o1,o2);

    } else if(tone==='organ'){
      const ratios=[1,2,3,4]; const amps=[0.5,0.28,0.14,0.08];
      ratios.forEach((r,i)=>{
        const o=audioCtx.createOscillator(); o.type='sine'; o.frequency.value=freq*r;
        const g=audioCtx.createGain(); g.gain.value=amps[i];
        o.connect(g).connect(out); o.start(now); stopNodes.push(o);
      });
      attack=0.015; decay=0.05; sustainLevel=0.92; release=0.09;

    } else if(tone==='jazzorgan'){
      const ratios=[1,2,3,4,6]; const amps=[0.45,0.3,0.22,0.12,0.08];
      ratios.forEach((r,i)=>{
        const o=audioCtx.createOscillator(); o.type='sine'; o.frequency.value=freq*r;
        const g=audioCtx.createGain(); g.gain.value=amps[i];
        o.connect(g).connect(out); o.start(now); stopNodes.push(o);
      });
      attack=0.02; decay=0.08; sustainLevel=0.8; release=0.35;
      addAmpLFO(5.8, sustainLevel*velocity*0.18);

    } else if(tone==='strings'){
      [-6,0,7].forEach(cents=>{
        const o=audioCtx.createOscillator(); o.type='sawtooth';
        o.frequency.value=freq*Math.pow(2,cents/1200);
        const g=audioCtx.createGain(); g.gain.value=0.33;
        const filter=audioCtx.createBiquadFilter(); filter.type='lowpass';
        filter.frequency.value=Math.min(5200,freq*5+900); filter.Q.value=0.5;
        o.connect(filter).connect(g).connect(out); o.start(now); stopNodes.push(o);
      });
      attack=0.35; decay=0.25; sustainLevel=0.55; release=1.4;
      addAmpLFO(4.2, sustainLevel*velocity*0.03);

    } else if(tone==='brass'){
      const o1=audioCtx.createOscillator(); o1.type='sawtooth';
      o1.frequency.setValueAtTime(freq*0.985, now);
      o1.frequency.linearRampToValueAtTime(freq, now+0.06);
      const o2=audioCtx.createOscillator(); o2.type='sawtooth'; o2.frequency.value=freq*1.003;
      const filter=audioCtx.createBiquadFilter(); filter.type='lowpass'; filter.Q.value=3;
      filter.frequency.setValueAtTime(600, now);
      filter.frequency.linearRampToValueAtTime(Math.min(6000,freq*7+1200), now+0.08);
      o1.connect(filter); o2.connect(filter); filter.connect(out);
      attack=0.05; decay=0.15; sustainLevel=0.6; release=0.3;
      o1.start(now); o2.start(now); stopNodes.push(o1,o2);

    } else if(tone==='bass'){
      const o1=audioCtx.createOscillator(); o1.type='sine'; o1.frequency.value=freq;
      const o2=audioCtx.createOscillator(); o2.type='triangle'; o2.frequency.value=freq;
      const o2g=audioCtx.createGain(); o2g.gain.value=0.5;
      const filter=audioCtx.createBiquadFilter(); filter.type='lowpass';
      filter.frequency.value=Math.min(1600,freq*4+300); filter.Q.value=0.7;
      o1.connect(filter); o2.connect(o2g).connect(filter); filter.connect(out);
      attack=0.004; decay=0.12; sustainLevel=0.55; release=0.25;
      o1.start(now); o2.start(now); stopNodes.push(o1,o2);

    } else if(tone==='choir'){
      const o1=audioCtx.createOscillator(); o1.type='triangle'; o1.frequency.value=freq;
      const o2=audioCtx.createOscillator(); o2.type='sine'; o2.frequency.value=freq*2.0;
      const o2g=audioCtx.createGain(); o2g.gain.value=0.18;
      const filter=audioCtx.createBiquadFilter(); filter.type='lowpass'; filter.frequency.value=2600; filter.Q.value=0.3;
      o1.connect(filter); o2.connect(o2g).connect(filter); filter.connect(out);
      attack=0.5; decay=0.3; sustainLevel=0.5; release=1.6;
      o1.start(now); o2.start(now); stopNodes.push(o1,o2);
      addAmpLFO(3.6, sustainLevel*velocity*0.025);

    } else if(tone==='musicbox'){
      const partials=[1,2.756,5.4]; const amps=[0.55,0.28,0.12];
      partials.forEach((r,i)=>{
        const o=audioCtx.createOscillator(); o.type='sine'; o.frequency.value=freq*r;
        const g=audioCtx.createGain(); g.gain.value=amps[i];
        o.connect(g).connect(out); o.start(now); stopNodes.push(o);
      });
      attack=0.001; decay=0.6; sustainLevel=0.06; release=0.6;

    } else {
      const o1=audioCtx.createOscillator(); o1.type='sawtooth'; o1.frequency.value=freq;
      const filter=audioCtx.createBiquadFilter(); filter.type='lowpass';
      filter.frequency.value=Math.min(6000,freq*6+800); filter.Q.value=2.5;
      o1.connect(filter).connect(out);
      attack=0.008; decay=0.25; sustainLevel=0.45; release=0.5;
      o1.start(now); stopNodes.push(o1);
    }

    if(customEnvelope){ attack=envAttack; decay=envDecay; sustainLevel=envSustain; release=envRelease; }

    out.gain.cancelScheduledValues(now);
    out.gain.setValueAtTime(0.0001, now);
    out.gain.exponentialRampToValueAtTime(Math.max(velocity,0.001), now+Math.max(attack,0.002));
    out.gain.linearRampToValueAtTime(Math.max(velocity*sustainLevel,0.0001), now+Math.max(attack,0.002)+decay);

    return {
      release(){
        const t=audioCtx.currentTime; const cur=Math.max(out.gain.value,0.0001);
        out.gain.cancelScheduledValues(t); out.gain.setValueAtTime(cur,t);
        out.gain.exponentialRampToValueAtTime(0.0001, t+Math.max(release,0.02));
        setTimeout(()=>{ stopNodes.forEach(n=>{try{n.stop();}catch(e){}}); try{out.disconnect();}catch(e){} }, Math.max(release,0.02)*1000+60);
      },
      hardStop(){
        const t=audioCtx.currentTime;
        out.gain.cancelScheduledValues(t); out.gain.setValueAtTime(0.0001,t);
        stopNodes.forEach(n=>{try{n.stop();}catch(e){}}); try{out.disconnect();}catch(e){}
      }
    };
  }

  // ---------- Visual keyboard ----------
  const keyboardEl = document.getElementById('keyboard');
  const keysScrollEl = document.getElementById('keysScroll');
  const MIN_WHITE_W = 14; // floor so keys never collapse to nothing on tiny screens
  let keyElements = {};

  function buildKeyboard(){
    keyElements = {}; CODE_TO_SEMITONE = {};
    const frag=document.createDocumentFragment(); const blackQueue=[];
    const bySemitone = new Map();
    layout.keys.forEach(k=>{
      if(!bySemitone.has(k.semitone)) bySemitone.set(k.semitone, []);
      bySemitone.get(k.semitone).push(k);
      CODE_TO_SEMITONE[k.code] = k.semitone;
    });
    const ordered = Array.from(bySemitone.keys()).sort((a,b)=>a-b);
    ordered.forEach(semitone=>{
      const group = bySemitone.get(semitone);
      const inOctave = semitone%12; const isBlack = BLACK_SET.has(inOctave);
      const el=document.createElement('div'); el.dataset.semitone=semitone;
      const hand = group[0].hand==='r' ? 'r' : 'l';
      const kbLabel=document.createElement('span'); kbLabel.className='key-label kb-label';
      kbLabel.textContent = group.map(k=>CODE_LABEL[k.code]||k.code).join('/');
      const noteLabel=document.createElement('span'); noteLabel.className='key-label note-label';
      el.className = (isBlack?'bkey':'wkey') + ' hand-'+hand;
      el.appendChild(kbLabel); el.appendChild(noteLabel);
      keyElements[semitone] = { el, kbLabel, noteLabel, isBlack, hand, x:0, w:0 };
      if(isBlack){ blackQueue.push(el); } else { frag.appendChild(el); }
    });
    blackQueue.forEach(el=>frag.appendChild(el));
    keyboardEl.innerHTML=''; keyboardEl.appendChild(frag);

    attachPointerHandlers();
    reflowKeyboard();
    updateOctaveLabels();
    updateSplitVisual();
    updateScaleVisual();
  }

  // Sizes and positions every key so the whole keyboard exactly fills the
  // available width, however wide or narrow the screen is. Keeps the same
  // DOM elements (so active/sustained/practice classes survive a resize)
  // and is safe to call on window resize as well as after building.
  function reflowKeyboard(){
    const semis = Object.keys(keyElements).map(Number).sort((a,b)=>a-b);
    if(!semis.length) return;
    const whiteCount = semis.filter(s=>!BLACK_SET.has(s%12)).length;
    const stylePad = 8; // matches .keys-scroll's 4px left+right padding
    const containerWidth = Math.max(60, (keysScrollEl.clientWidth || keyboardEl.parentElement.offsetWidth || 320) - stylePad);
    const gap = 1;
    let whiteW = Math.floor((containerWidth - gap*(whiteCount-1)) / whiteCount);
    whiteW = Math.max(MIN_WHITE_W, whiteW);
    const blackW = Math.max(8, Math.round(whiteW*0.6));

    let wi=0;
    semis.forEach(s=>{
      const info = keyElements[s];
      let x, w;
      if(info.isBlack){
        x = wi*(whiteW+gap) - blackW/2; w = blackW;
      } else {
        x = wi*(whiteW+gap); w = whiteW; wi++;
      }
      info.el.style.left = x+'px'; info.el.style.width = w+'px';
      info.x = x; info.w = w;
    });
    keyboardEl.style.width = (wi*(whiteW+gap))+'px';
    resizeCanvas();
  }

  function updateOctaveLabels(){
    Object.keys(keyElements).forEach(semStr=>{
      const semitone=parseInt(semStr,10); const inOctave=semitone%12;
      const octaveNum=baseOctave+Math.floor(semitone/12);
      keyElements[semitone].noteLabel.textContent = NOTE_NAMES[inOctave]+octaveNum;
    });
    const semis = Object.keys(keyElements).map(Number).sort((a,b)=>a-b);
    if(semis.length){
      const low=semis[0], high=semis[semis.length-1];
      const lowName=NOTE_NAMES[low%12]+(baseOctave+Math.floor(low/12));
      const highName=NOTE_NAMES[high%12]+(baseOctave+Math.floor(high/12));
      document.getElementById('octaveReadout').textContent = lowName+' – '+highName;
    }
    updateSplitVisual();
    if(practiceActive){ regeneratePracticeSequence(); highlightPracticeTarget(); }
  }

  function baseMidiFor(semitone, octaveOverride){
    const octave = octaveOverride!=null ? octaveOverride : baseOctave;
    return (octave+Math.floor(semitone/12)+1)*12 + (semitone%12);
  }
  function semitoneAndVisibleForMidi(baseMidi){
    const semitone = baseMidi - (baseOctave+1)*12;
    return keyElements[semitone] ? semitone : null;
  }

  function updateSplitVisual(){
    Object.entries(keyElements).forEach(([semStr, info])=>{
      const semitone=parseInt(semStr,10);
      info.el.classList.toggle('split-below', splitOn && baseMidiFor(semitone) < splitPointMidi);
    });
  }
  function updateScaleVisual(){
    const intervals = SCALE_DEFS[scaleType];
    Object.entries(keyElements).forEach(([semStr, info])=>{
      const semitone=parseInt(semStr,10);
      let inScale=false;
      if(intervals){ const rel=((semitone-scaleRoot)%12+12)%12; inScale=intervals.indexOf(rel)!==-1; }
      info.el.classList.toggle('in-scale', inScale);
    });
  }
  function setKeyVisual(semitone, cls, on){
    if(semitone==null) return;
    const info=keyElements[semitone]; if(!info) return;
    info.el.classList.toggle(cls, on);
  }

  // ---------- Note trigger / release ----------
  function velocityFor(base){ const jitter=(Math.random()*0.06)-0.03; return Math.min(1, Math.max(0.05, base+jitter)); }
  function voicesForNote(baseMidi, primaryTone){
    if(splitOn && baseMidi < splitPointMidi) return [splitVoice];
    const list=[primaryTone]; if(dualOn) list.push(dualVoice); return list;
  }

  const liveTrailsById = new Map();

  function noteOn(id, semitone, opts){
    opts = opts || {};
    if(activeVoices.has(id)) return;
    initAudio(); if(audioCtx.state==='suspended') audioCtx.resume();
    let baseMidi;
    if(opts.absMidi!=null){ baseMidi = opts.absMidi; }
    else { const octave = opts.octave!=null?opts.octave:baseOctave; baseMidi = baseMidiFor(semitone, octave); }
    const playMidi = baseMidi + transposeSemitones;
    const freq = freqFromMidi(playMidi);
    const baseVelocity = opts.velocity!=null ? opts.velocity : 0.8;
    const tones = voicesForNote(baseMidi, opts.tone || currentTone);
    const voices = tones.map(t=>createVoice(freq, t, velocityFor(baseVelocity)*0.9));
    activeVoices.set(id, { voices, sustained:false, semitone, baseMidi });
    setKeyVisual(semitone, 'active', true);

    capturesList.forEach(c=>c.events.push({ t: audioCtx.currentTime-c.startAudioTime, type:'on', baseMidi, tone: opts.tone||currentTone, velocity: baseVelocity }));

    if(opts.live){
      liveTrailsById.set(id, { baseMidi, startPerf: performance.now(), endPerf: null });
    }
    if(opts.practice && practiceActive){ evaluatePractice(baseMidi); }
  }

  function releaseEntry(entry){ entry.voices.forEach(v=>v.release()); }

  function noteOff(id){
    const entry = activeVoices.get(id);
    if(!entry) return;
    if(liveTrailsById.has(id)) liveTrailsById.get(id).endPerf = performance.now();
    if(sustainOn){
      entry.sustained=true;
      setKeyVisual(entry.semitone,'active',false); setKeyVisual(entry.semitone,'sustained',true);
      capturesList.forEach(c=>c.events.push({ t: audioCtx.currentTime-c.startAudioTime, type:'off', baseMidi: entry.baseMidi }));
      return;
    }
    releaseEntry(entry); activeVoices.delete(id);
    setKeyVisual(entry.semitone,'active',false); setKeyVisual(entry.semitone,'sustained',false);
    capturesList.forEach(c=>c.events.push({ t: audioCtx.currentTime-c.startAudioTime, type:'off', baseMidi: entry.baseMidi }));
  }

  function releaseSustainedNotes(){
    activeVoices.forEach((entry, id)=>{
      if(entry.sustained){ releaseEntry(entry); setKeyVisual(entry.semitone,'sustained',false); activeVoices.delete(id); }
    });
  }

  function panic(){
    activeVoices.forEach(entry=>entry.voices.forEach(v=>v.hardStop()));
    activeVoices.clear(); pressedCodes.clear(); liveTrailsById.clear();
    Object.values(keyElements).forEach(k=>{ k.el.classList.remove('active'); k.el.classList.remove('sustained'); });
  }

  // ---------- Physical keyboard ----------
  function isTypingTarget(el){ return el && (el.tagName==='INPUT'||el.tagName==='SELECT'||el.tagName==='TEXTAREA'); }

  window.addEventListener('keydown', (e)=>{
    if(isTypingTarget(document.activeElement)) return;
    if(e.code==='Space'){ e.preventDefault(); if(!sustainOn){ sustainOn=true; setPedalVisual(true); } return; }
    if(e.code==='ArrowUp'){ e.preventDefault(); shiftOctave(1); return; }
    if(e.code==='ArrowDown'){ e.preventDefault(); shiftOctave(-1); return; }
    const semitone = CODE_TO_SEMITONE[e.code];
    if(semitone===undefined) return;
    e.preventDefault();
    if(pressedCodes.has(e.code)) return;
    pressedCodes.add(e.code);
    noteOn('kb:'+e.code, semitone, { velocity:0.85, live:true, practice:true });
  });
  window.addEventListener('keyup', (e)=>{
    if(e.code==='Space'){ sustainOn=false; setPedalVisual(false); releaseSustainedNotes(); return; }
    const semitone = CODE_TO_SEMITONE[e.code];
    if(semitone===undefined) return;
    pressedCodes.delete(e.code);
    noteOff('kb:'+e.code);
  });
  window.addEventListener('blur', ()=>{
    pressedCodes.forEach(code=>noteOff('kb:'+code)); pressedCodes.clear();
    sustainOn=false; setPedalVisual(false); releaseSustainedNotes();
  });

  // ---------- Pointer ----------
  const activePointers = new Map();
  function attachPointerHandlers(){
    Object.entries(keyElements).forEach(([semitoneStr, info])=>{
      const semitone = parseInt(semitoneStr,10); const el = info.el;
      el.addEventListener('pointerdown', (e)=>{
        e.preventDefault(); initAudio(); if(audioCtx.state==='suspended') audioCtx.resume();
        activePointers.set(e.pointerId, semitone);
        noteOn('ptr:'+e.pointerId, semitone, { velocity:0.8, live:true, practice:true });
      });
      el.addEventListener('pointerenter', (e)=>{
        if(!activePointers.has(e.pointerId)) return;
        const prev = activePointers.get(e.pointerId); if(prev===semitone) return;
        noteOff('ptr:'+e.pointerId);
        activePointers.set(e.pointerId, semitone);
        noteOn('ptr:'+e.pointerId, semitone, { velocity:0.8, live:true, practice:true });
      });
    });
  }
  function endPointer(e){ if(!activePointers.has(e.pointerId)) return; noteOff('ptr:'+e.pointerId); activePointers.delete(e.pointerId); }
  window.addEventListener('pointerup', endPointer);
  window.addEventListener('pointercancel', endPointer);

  // ---------- Sustain pedal ----------
  const pedalEl = document.getElementById('pedal');
  function setPedalVisual(on){ pedalEl.classList.toggle('pressed', on); }
  pedalEl.addEventListener('pointerdown', (e)=>{ e.preventDefault(); initAudio(); sustainOn=true; setPedalVisual(true); });
  pedalEl.addEventListener('pointerup', ()=>{ sustainOn=false; setPedalVisual(false); releaseSustainedNotes(); });
  pedalEl.addEventListener('pointerleave', ()=>{ if(sustainOn){ sustainOn=false; setPedalVisual(false); releaseSustainedNotes(); } });

  // ---------- Octave / Transpose ----------
  function shiftOctave(delta){ baseOctave = Math.min(layout.octaveMax, Math.max(layout.octaveMin, baseOctave+delta)); updateOctaveLabels(); }
  document.getElementById('octUp').addEventListener('click', ()=>shiftOctave(1));
  document.getElementById('octDown').addEventListener('click', ()=>shiftOctave(-1));
  function setTranspose(v){ transposeSemitones = Math.min(12, Math.max(-12, v)); document.getElementById('transposeReadout').textContent = (transposeSemitones>0?'+':'')+transposeSemitones+' st'; }
  document.getElementById('transUp').addEventListener('click', ()=>setTranspose(transposeSemitones+1));
  document.getElementById('transDown').addEventListener('click', ()=>setTranspose(transposeSemitones-1));

  // ---------- Voice selects ----------
  function fillToneSelect(sel, def){ TONE_LIST.forEach(t=>{ const o=document.createElement('option'); o.value=t.value; o.textContent=t.label; sel.appendChild(o); }); sel.value=def; }
  const toneSelect=document.getElementById('toneSelect'), dualSelect=document.getElementById('dualSelect'), splitSelect=document.getElementById('splitSelect');
  fillToneSelect(toneSelect,'grand'); fillToneSelect(dualSelect,'strings'); fillToneSelect(splitSelect,'bass');
  toneSelect.addEventListener('change', e=>currentTone=e.target.value);
  dualSelect.addEventListener('change', e=>dualVoice=e.target.value);
  splitSelect.addEventListener('change', e=>splitVoice=e.target.value);

  // ---------- Dual / Split ----------
  const dualToggleBtn=document.getElementById('dualToggle'), dualVoiceCtrl=document.getElementById('dualVoiceCtrl');
  dualToggleBtn.addEventListener('click', ()=>{
    dualOn=!dualOn; dualToggleBtn.textContent=dualOn?'On':'Off'; dualToggleBtn.classList.toggle('on',dualOn);
    dualVoiceCtrl.style.display=dualOn?'flex':'none';
  });
  const splitToggleBtn=document.getElementById('splitToggle'), splitVoiceCtrl=document.getElementById('splitVoiceCtrl'), splitPointCtrl=document.getElementById('splitPointCtrl');
  splitToggleBtn.addEventListener('click', ()=>{
    splitOn=!splitOn; splitToggleBtn.textContent=splitOn?'On':'Off'; splitToggleBtn.classList.toggle('on',splitOn);
    splitVoiceCtrl.style.display=splitOn?'flex':'none'; splitPointCtrl.style.display=splitOn?'flex':'none';
    updateSplitVisual();
  });
  const splitPointInput=document.getElementById('splitPoint'), splitPointReadout=document.getElementById('splitPointReadout');
  splitPointInput.addEventListener('input', e=>{
    splitPointMidi=parseInt(e.target.value,10);
    splitPointReadout.textContent = NOTE_NAMES[splitPointMidi%12]+(Math.floor(splitPointMidi/12)-1);
    updateSplitVisual();
  });
  splitPointReadout.textContent = NOTE_NAMES[splitPointMidi%12]+(Math.floor(splitPointMidi/12)-1);

  // ---------- Legend ----------
  const legendBody=document.getElementById('legendBody');
  function renderLegend(){
    let body='<b>Two full octaves, twelve keys each, mapped straight onto your keyboard.</b><ul>'+
      '<li><b>A S D F G H J</b> — left hand, white keys &nbsp;·&nbsp; <b>W E T Y U</b> — left hand, black keys</li>'+
      '<li><b>K L ; \' \\ M ,</b> — right hand, white keys &nbsp;·&nbsp; <b>I O P [ ]</b> — right hand, black keys</li></ul>';
    body += 'Hold down more than one key at once to play a <b>chord</b>. Hold <b>Space</b>, or the <b>SUSTAIN</b> pedal, to let notes ring after you lift your fingers. '+
      '<b>Octave</b> slides both hands up or down the piano together; <b>Transpose</b> shifts pitch without moving your hands. '+
      '<b>Dual</b> layers a second voice on every note; <b>Split</b> gives your left hand its own voice below a chosen note. '+
      'Plug in a real MIDI keyboard under <b>Pro tools</b>, shape each voice with the <b>Effects</b> and <b>Envelope</b> panels, turn on <b>Scale</b> highlighting and <b>Practice mode</b> to train your ear and your fingers, and layer up to four takes with the <b>Looper</b>.';
    legendBody.innerHTML = body;
  }

  // ---------- Volume / reverb / labels / viz toggle ----------
  document.getElementById('volSlider').addEventListener('input', e=>{ initAudio(); masterGain.gain.setTargetAtTime(parseFloat(e.target.value)/100, audioCtx.currentTime, 0.01); });
  document.getElementById('reverbSlider').addEventListener('input', e=>{ initAudio(); wetGain.gain.setTargetAtTime((parseFloat(e.target.value)/100)*0.6, audioCtx.currentTime, 0.01); });
  const labelToggleBtn=document.getElementById('labelToggle');
  labelToggleBtn.addEventListener('click', ()=>{ const showing=keyboardEl.classList.toggle('show-notes'); labelToggleBtn.textContent = showing?'Show key letters':'Show note names'; });
  document.getElementById('panicBtn').addEventListener('click', panic);
  const vizToggleBtn=document.getElementById('vizToggle');
  vizToggleBtn.addEventListener('click', ()=>{ vizEnabled=!vizEnabled; vizToggleBtn.textContent=vizEnabled?'On':'Off'; vizToggleBtn.classList.toggle('on',vizEnabled); if(!vizEnabled){ vizCtx.clearRect(0,0,vizCanvas.width,vizCanvas.height); } });

  // ---------- Effects wiring ----------
  document.getElementById('distSlider').addEventListener('input', e=>{ initAudio(); const m=parseFloat(e.target.value)/100; distDry.gain.setTargetAtTime(1-m, audioCtx.currentTime, 0.01); distWet.gain.setTargetAtTime(m, audioCtx.currentTime, 0.01); });
  document.getElementById('chorusSlider').addEventListener('input', e=>{ initAudio(); const m=parseFloat(e.target.value)/100; chorusDry.gain.setTargetAtTime(1-m, audioCtx.currentTime, 0.01); chorusWet.gain.setTargetAtTime(m, audioCtx.currentTime, 0.01); });
  document.getElementById('delaySlider').addEventListener('input', e=>{ initAudio(); const m=(parseFloat(e.target.value)/100)*0.6; delayWet.gain.setTargetAtTime(m, audioCtx.currentTime, 0.01); });
  document.getElementById('delayTimeSlider').addEventListener('input', e=>{ initAudio(); delayNode.delayTime.setTargetAtTime(parseFloat(e.target.value)/1000, audioCtx.currentTime, 0.01); });
  document.getElementById('delayFbSlider').addEventListener('input', e=>{ initAudio(); delayFeedbackGain.gain.setTargetAtTime(parseFloat(e.target.value)/100, audioCtx.currentTime, 0.01); });

  // ---------- Envelope wiring ----------
  const envToggleBtn=document.getElementById('envToggle');
  envToggleBtn.addEventListener('click', ()=>{ customEnvelope=!customEnvelope; envToggleBtn.textContent=customEnvelope?'On':'Off'; envToggleBtn.classList.toggle('on',customEnvelope); });
  document.getElementById('attackSlider').addEventListener('input', e=>envAttack=parseFloat(e.target.value)/1000);
  document.getElementById('decaySlider').addEventListener('input', e=>envDecay=parseFloat(e.target.value)/1000);
  document.getElementById('sustainSlider').addEventListener('input', e=>envSustain=parseFloat(e.target.value)/100);
  document.getElementById('releaseSlider').addEventListener('input', e=>envRelease=parseFloat(e.target.value)/1000);

  // ---------- MIDI ----------
  let midiAccess=null;
  const midiEnableBtn=document.getElementById('midiEnableBtn'), midiStatus=document.getElementById('midiStatus');
  const midiDeviceCtrl=document.getElementById('midiDeviceCtrl'), midiInputSelect=document.getElementById('midiInputSelect');
  function handleMIDIMessage(msg){
    const data=msg.data; const cmd=data[0]&0xf0; const d1=data[1], d2=data[2];
    initAudio(); if(audioCtx.state==='suspended') audioCtx.resume();
    if(cmd===0x90 && d2>0){
      const semitone = semitoneAndVisibleForMidi(d1);
      noteOn('midi:'+d1, semitone, { absMidi:d1, velocity:d2/127, live:true, practice:true });
    } else if(cmd===0x80 || (cmd===0x90 && d2===0)){
      noteOff('midi:'+d1);
    } else if(cmd===0xB0 && d1===64){
      if(d2>=64){ if(!sustainOn){ sustainOn=true; setPedalVisual(true); } }
      else { sustainOn=false; setPedalVisual(false); releaseSustainedNotes(); }
    }
  }
  function refreshMIDIInputs(){
    const inputs=Array.from(midiAccess.inputs.values());
    midiInputSelect.innerHTML='';
    if(inputs.length===0){ midiStatus.textContent='No MIDI devices found.'; midiDeviceCtrl.style.display='none'; return; }
    inputs.forEach(inp=>{ const o=document.createElement('option'); o.value=inp.id; o.textContent=inp.name; midiInputSelect.appendChild(o); inp.onmidimessage=handleMIDIMessage; });
    midiDeviceCtrl.style.display='flex';
    midiStatus.textContent='Connected: '+inputs.map(i=>i.name).join(', ');
  }
  midiEnableBtn.addEventListener('click', ()=>{
    if(!navigator.requestMIDIAccess){ midiStatus.textContent='Not supported in this browser.'; return; }
    navigator.requestMIDIAccess().then(access=>{
      midiAccess=access; refreshMIDIInputs(); access.onstatechange=refreshMIDIInputs;
      midiEnableBtn.textContent='MIDI enabled'; midiEnableBtn.classList.add('on');
    }).catch(()=>{ midiStatus.textContent='Permission denied.'; });
  });

  // ---------- Scale & practice ----------
  document.getElementById('scaleSelect').addEventListener('change', e=>{ scaleType=e.target.value; updateScaleVisual(); if(practiceActive){ regeneratePracticeSequence(); highlightPracticeTarget(); } });
  document.getElementById('rootSelect').addEventListener('change', e=>{ scaleRoot=parseInt(e.target.value,10); updateScaleVisual(); if(practiceActive){ regeneratePracticeSequence(); highlightPracticeTarget(); } });

  let practiceActive=false, practiceSequence=[], practiceIndex=0;
  let practiceStats={ correct:0, misses:0, attempts:0 }, practiceStartPerf=0;
  const practiceToggleBtn=document.getElementById('practiceToggle');
  function regeneratePracticeSequence(){
    const intervals = SCALE_DEFS[scaleType] || [0,1,2,3,4,5,6,7,8,9,10,11];
    const semis = Object.keys(keyElements).map(Number).sort((a,b)=>a-b).filter(s=>{
      const rel=((s-scaleRoot)%12+12)%12; return intervals.indexOf(rel)!==-1;
    });
    practiceSequence = semis.map(s=>baseMidiFor(s));
    practiceIndex = 0;
  }
  function highlightPracticeTarget(){
    Object.values(keyElements).forEach(k=>k.el.classList.remove('practice-target'));
    if(!practiceActive || !practiceSequence.length) return;
    const target = practiceSequence[practiceIndex];
    Object.entries(keyElements).forEach(([semStr, info])=>{
      if(baseMidiFor(parseInt(semStr,10))===target) info.el.classList.add('practice-target');
    });
  }
  function updatePracticeStatsUI(){
    document.getElementById('statCorrect').textContent = practiceStats.correct;
    document.getElementById('statMiss').textContent = practiceStats.misses;
    const acc = practiceStats.attempts ? Math.round(practiceStats.correct/practiceStats.attempts*100) : 0;
    document.getElementById('statAcc').textContent = acc+'%';
    const mins = Math.max((performance.now()-practiceStartPerf)/60000, 0.01);
    document.getElementById('statSpeed').textContent = Math.round(practiceStats.correct/mins);
  }
  function evaluatePractice(baseMidi){
    if(!practiceSequence.length) return;
    practiceStats.attempts++;
    if(baseMidi === practiceSequence[practiceIndex]){
      practiceStats.correct++;
      practiceIndex = (practiceIndex+1) % practiceSequence.length;
      highlightPracticeTarget();
    } else { practiceStats.misses++; }
    updatePracticeStatsUI();
  }
  practiceToggleBtn.addEventListener('click', ()=>{
    practiceActive = !practiceActive;
    practiceToggleBtn.textContent = practiceActive ? 'Stop' : 'Start';
    practiceToggleBtn.classList.toggle('active-toggle', practiceActive);
    if(practiceActive){
      practiceStats={correct:0,misses:0,attempts:0}; practiceStartPerf=performance.now();
      regeneratePracticeSequence(); highlightPracticeTarget(); updatePracticeStatsUI();
    } else {
      Object.values(keyElements).forEach(k=>k.el.classList.remove('practice-target'));
    }
  });

  // ---------- Drum kit ----------
  function noiseSource(){ const s=audioCtx.createBufferSource(); s.buffer=noiseBuffer; return s; }
  function playKick(t){
    const o=audioCtx.createOscillator(); o.type='sine';
    o.frequency.setValueAtTime(150,t); o.frequency.exponentialRampToValueAtTime(45,t+0.12);
    const g=audioCtx.createGain(); g.gain.setValueAtTime(0.9,t); g.gain.exponentialRampToValueAtTime(0.001,t+0.28);
    o.connect(g).connect(drumGain); o.start(t); o.stop(t+0.3);
  }
  function playSnare(t){
    const src=noiseSource(); const bp=audioCtx.createBiquadFilter(); bp.type='bandpass'; bp.frequency.value=1800; bp.Q.value=0.8;
    const g=audioCtx.createGain(); g.gain.setValueAtTime(0.7,t); g.gain.exponentialRampToValueAtTime(0.001,t+0.16);
    src.connect(bp).connect(g).connect(drumGain); src.start(t); src.stop(t+0.18);
    const o=audioCtx.createOscillator(); o.type='triangle'; o.frequency.value=190;
    const og=audioCtx.createGain(); og.gain.setValueAtTime(0.22,t); og.gain.exponentialRampToValueAtTime(0.001,t+0.1);
    o.connect(og).connect(drumGain); o.start(t); o.stop(t+0.12);
  }
  function playHat(t, open){
    const src=noiseSource(); const hp=audioCtx.createBiquadFilter(); hp.type='highpass'; hp.frequency.value=7000;
    const g=audioCtx.createGain(); const dur=open?0.28:0.06;
    g.gain.setValueAtTime(open?0.32:0.26,t); g.gain.exponentialRampToValueAtTime(0.001,t+dur);
    src.connect(hp).connect(g).connect(drumGain); src.start(t); src.stop(t+dur+0.02);
  }
  function playClickSound(t, accent){
    const o=audioCtx.createOscillator(); o.type='square'; o.frequency.value=accent?1500:900;
    const g=audioCtx.createGain(); g.gain.setValueAtTime(0.0001,t);
    g.gain.exponentialRampToValueAtTime(accent?0.5:0.32,t+0.002); g.gain.exponentialRampToValueAtTime(0.0001,t+0.05);
    o.connect(g).connect(drumGain); o.start(t); o.stop(t+0.06);
  }
  function step(k,s,h){ return {k:!!k,s:!!s,h:h||null}; }
  const EMPTY=step();
  function pattern16(hits){ const arr=[]; for(let i=0;i<16;i++) arr.push(hits[i]||EMPTY); return arr; }
  const PATTERNS = {
    pop: pattern16({0:step(1,0,'closed'),4:step(0,1,'closed'),8:step(1,0,'closed'),12:step(0,1,'closed'),14:step(0,0,'open')}),
    rock: pattern16({0:step(1,0,'closed'),1:step(0,0,'closed'),2:step(0,0,'closed'),3:step(0,0,'closed'),4:step(0,1,'closed'),5:step(0,0,'closed'),6:step(0,0,'closed'),7:step(0,0,'closed'),8:step(1,0,'closed'),9:step(0,0,'closed'),10:step(1,0,'closed'),11:step(0,0,'closed'),12:step(0,1,'closed'),13:step(0,0,'closed'),14:step(0,0,'closed'),15:step(0,0,'closed')}),
    jazz: (function(){ const p=pattern16({0:step(1,0,'closed'),4:step(0,1,null),8:step(0,0,'closed'),10:step(1,0,null),12:step(0,1,null)}); p.swingSet=new Set([2,6,10,14]); p[2]=step(0,0,'closed'); p[6]=step(0,0,'closed'); p[14]=step(0,0,'closed'); return p; })(),
    latin: pattern16({0:step(1,0,'closed'),2:step(0,0,'closed'),4:step(0,1,'closed'),6:step(1,0,'closed'),8:step(0,0,'closed'),10:step(1,0,'closed'),12:step(0,1,'closed'),14:step(0,1,'closed')}),
    ballad: pattern16({0:step(1,0,'closed'),4:step(0,1,'closed'),8:step(1,0,'closed'),12:step(0,1,'closed')})
  };
  let rhythmRunning=false, rhythmTimer=null, nextStepTime=0, stepIndex=0;
  function stepDuration(){ const bpm=parseFloat(document.getElementById('bpmInput').value)||100; return (60/bpm)/4; }
  function scheduleStep(idx, t){
    const style=document.getElementById('styleSelect').value;
    if(style==='click'){ if(idx%4===0) playClickSound(t, idx%16===0); return; }
    const pattern=PATTERNS[style]; if(!pattern) return;
    const s=pattern[idx%16]; if(!s) return;
    if(s.k) playKick(t); if(s.s) playSnare(t); if(s.h) playHat(t, s.h==='open');
  }
  function rhythmScheduler(){
    const style=document.getElementById('styleSelect').value; const pattern=PATTERNS[style];
    while(nextStepTime < audioCtx.currentTime+0.12){
      let t=nextStepTime;
      if(pattern && pattern.swingSet && pattern.swingSet.has(stepIndex%16)) t += stepDuration()*0.5;
      scheduleStep(stepIndex, t); nextStepTime += stepDuration(); stepIndex++;
    }
  }
  document.getElementById('rhythmToggle').addEventListener('click', (e)=>{
    initAudio(); if(audioCtx.state==='suspended') audioCtx.resume();
    rhythmRunning=!rhythmRunning;
    if(rhythmRunning){
      stepIndex=0; nextStepTime=audioCtx.currentTime+0.05; rhythmTimer=setInterval(rhythmScheduler,25);
      e.target.textContent='Stop'; e.target.classList.add('active-toggle');
    } else { clearInterval(rhythmTimer); e.target.textContent='Start'; e.target.classList.remove('active-toggle'); }
  });

  // ---------- Simple recorder ----------
  const recBtn=document.getElementById('recToggle'), playBtn=document.getElementById('playToggle'), clearBtn=document.getElementById('clearRec');
  recBtn.addEventListener('click', ()=>{
    initAudio(); if(audioCtx.state==='suspended') audioCtx.resume();
    if(!simpleRecording){
      simpleRecording=true; simpleCapture={events:[], startAudioTime:audioCtx.currentTime}; capturesList.push(simpleCapture);
      recBtn.textContent='■ Stop'; recBtn.classList.add('rec-on'); playBtn.disabled=true; clearBtn.disabled=true;
    } else {
      simpleRecording=false;
      const idx=capturesList.indexOf(simpleCapture); if(idx>-1) capturesList.splice(idx,1);
      recordedEvents=simpleCapture.events; simpleCapture=null;
      recBtn.textContent='● Rec'; recBtn.classList.remove('rec-on');
      playBtn.disabled=recordedEvents.length===0; clearBtn.disabled=recordedEvents.length===0;
    }
  });
  function buildSpans(events){
    const openMap=new Map(); const spans=[];
    events.forEach(ev=>{
      if(ev.type==='on'){
        if(!openMap.has(ev.baseMidi)) openMap.set(ev.baseMidi, []);
        const span={ baseMidi:ev.baseMidi, tStart:ev.t, tEnd:null };
        openMap.get(ev.baseMidi).push(span); spans.push(span);
      } else {
        const q=openMap.get(ev.baseMidi);
        if(q && q.length){ q.shift().tEnd = ev.t; }
      }
    });
    spans.forEach(sp=>{ if(sp.tEnd==null) sp.tEnd = sp.tStart+0.4; });
    return spans;
  }
  playBtn.addEventListener('click', ()=>{
    if(isPlaying){
      playTimers.forEach(id=>clearTimeout(id)); playTimers=[]; isPlaying=false;
      playBtn.textContent='▶ Play'; fallingSpans=[]; fallingPlaybackStartPerf=null;
      return;
    }
    if(recordedEvents.length===0) return;
    isPlaying=true; playBtn.textContent='■ Stop';
    fallingSpans = buildSpans(recordedEvents); fallingPlaybackStartPerf = performance.now();
    recordedEvents.forEach(ev=>{
      const id='rec:'+ev.baseMidi;
      const timer=setTimeout(()=>{
        if(ev.type==='on'){ noteOn(id, null, { absMidi:ev.baseMidi, tone:ev.tone, velocity:ev.velocity }); }
        else { const entry=activeVoices.get(id); if(entry){ releaseEntry(entry); activeVoices.delete(id); setKeyVisual(entry.semitone,'active',false); setKeyVisual(entry.semitone,'sustained',false); } }
      }, ev.t*1000);
      playTimers.push(timer);
    });
    const lastTime = recordedEvents[recordedEvents.length-1].t*1000+400;
    playTimers.push(setTimeout(()=>{ isPlaying=false; playBtn.textContent='▶ Play'; fallingSpans=[]; fallingPlaybackStartPerf=null; }, lastTime));
  });
  clearBtn.addEventListener('click', ()=>{ recordedEvents=[]; playBtn.disabled=true; clearBtn.disabled=true; });

  // ---------- Looper ----------
  const looper = { loopSeconds:null, running:false, cycleTimers:[], tracks:[0,1,2,3].map(()=>({events:[],recording:false,muted:false,hasContent:false})) };
  const loopBarsSelect=document.getElementById('loopBars'), loopLenReadout=document.getElementById('loopLenReadout'), stopLoopBtn=document.getElementById('stopLoopBtn');
  function currentBpm(){ return parseFloat(document.getElementById('bpmInput').value)||100; }
  function loopSecondsFromBars(bars){ return bars*4*(60/currentBpm()); }
  function trackRow(idx){ return document.querySelector('.looper-track[data-idx="'+idx+'"]'); }
  function setTrackStatus(idx, text){ trackRow(idx).querySelector('.track-status').textContent = text; }

  function startRecordingTrack(idx){
    initAudio(); if(audioCtx.state==='suspended') audioCtx.resume();
    const track = looper.tracks[idx];
    if(track.recording) return;
    if(looper.loopSeconds==null){
      looper.loopSeconds = loopSecondsFromBars(parseInt(loopBarsSelect.value,10));
      loopLenReadout.textContent = looper.loopSeconds.toFixed(1)+'s';
      beginTrackCapture(idx, audioCtx.currentTime);
    } else {
      const elapsedInCycle = (audioCtx.currentTime - looper.cycleStartAudioTime) % looper.loopSeconds;
      const waitSec = looper.loopSeconds - elapsedInCycle;
      setTrackStatus(idx, 'Armed…');
      track.pendingTimer = setTimeout(()=>beginTrackCapture(idx, audioCtx.currentTime), waitSec*1000);
    }
  }
  function beginTrackCapture(idx, startAudioTime){
    const track = looper.tracks[idx];
    track.recording = true; track.capture = { events:[], startAudioTime };
    capturesList.push(track.capture);
    setTrackStatus(idx, 'Recording…');
    setTimeout(()=>finishTrackCapture(idx), looper.loopSeconds*1000);
  }
  function finishTrackCapture(idx){
    const track = looper.tracks[idx];
    activeVoices.forEach(entry=>{
      track.capture.events.push({ t: looper.loopSeconds, type:'off', baseMidi: entry.baseMidi });
    });
    const ci = capturesList.indexOf(track.capture); if(ci>-1) capturesList.splice(ci,1);
    track.events = track.capture.events; track.capture=null; track.recording=false; track.hasContent = track.events.length>0;
    setTrackStatus(idx, track.hasContent ? 'Recorded' : 'Empty');
    if(!looper.running && track.hasContent){
      looper.running = true; looper.cycleStartAudioTime = audioCtx.currentTime;
      scheduleLoopCycle();
    }
  }
  function scheduleLoopCycle(){
    looper.tracks.forEach((track, idx)=>{
      if(track.hasContent && !track.muted){
        track.events.forEach(ev=>{
          const id='loop'+idx+':'+ev.baseMidi;
          const timer=setTimeout(()=>{
            if(ev.type==='on'){ noteOn(id, null, { absMidi:ev.baseMidi, tone:ev.tone, velocity:ev.velocity }); }
            else { const entry=activeVoices.get(id); if(entry){ releaseEntry(entry); activeVoices.delete(id); setKeyVisual(entry.semitone,'active',false); } }
          }, ev.t*1000);
          looper.cycleTimers.push(timer);
        });
      }
    });
    const nextTimer = setTimeout(scheduleLoopCycle, looper.loopSeconds*1000);
    looper.cycleTimers.push(nextTimer);
  }
  function stopLooper(){
    looper.cycleTimers.forEach(t=>clearTimeout(t)); looper.cycleTimers=[];
    looper.running=false; looper.loopSeconds=null;
    looper.tracks.forEach((track, idx)=>{
      if(track.pendingTimer) clearTimeout(track.pendingTimer);
      track.events=[]; track.hasContent=false; track.muted=false; track.recording=false; track.capture=null;
      setTrackStatus(idx, 'Empty');
      trackRow(idx).querySelector('.track-mute').textContent='Mute';
    });
    loopLenReadout.textContent='not set';
  }
  stopLoopBtn.addEventListener('click', stopLooper);
  document.querySelectorAll('.looper-track').forEach(row=>{
    const idx = parseInt(row.dataset.idx,10);
    row.querySelector('.track-rec').addEventListener('click', ()=>startRecordingTrack(idx));
    row.querySelector('.track-mute').addEventListener('click', ()=>{
      const track=looper.tracks[idx]; track.muted=!track.muted;
      row.querySelector('.track-mute').textContent = track.muted?'Unmute':'Mute';
      if(track.hasContent) setTrackStatus(idx, track.muted?'Muted':'Recorded');
    });
    row.querySelector('.track-clear').addEventListener('click', ()=>{
      const track=looper.tracks[idx]; track.events=[]; track.hasContent=false; track.muted=false;
      row.querySelector('.track-mute').textContent='Mute'; setTrackStatus(idx,'Empty');
      if(looper.tracks.every(t=>!t.hasContent)) stopLooper();
    });
  });

  // ---------- Falling-notes visualizer ----------
  const vizCanvas=document.getElementById('vizCanvas'); const vizCtx=vizCanvas.getContext('2d');
  let fallingSpans=[], fallingPlaybackStartPerf=null;
  function resizeCanvas(){
    const w = parseInt(keyboardEl.style.width,10) || keyboardEl.offsetWidth || 300;
    vizCanvas.width = w; vizCanvas.style.width = w+'px';
  }
  function drawRoundRect(ctx,x,y,w,h,r){
    if(w<=0||h<=0) return;
    r=Math.min(r, w/2, h/2);
    ctx.beginPath(); ctx.moveTo(x+r,y); ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r);
    ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r); ctx.closePath();
  }
  function renderViz(){
    requestAnimationFrame(renderViz);
    if(!vizEnabled){ return; }
    vizCtx.clearRect(0,0,vizCanvas.width,vizCanvas.height);
    const nowPerf = performance.now();
    const canvasH = vizCanvas.height;

    if(fallingPlaybackStartPerf!=null){
      const elapsed = (nowPerf-fallingPlaybackStartPerf)/1000;
      const fallDuration = 2.0; const speed = canvasH/fallDuration;
      fallingSpans.forEach(sp=>{
        const semitone = semitoneAndVisibleForMidi(sp.baseMidi);
        if(semitone==null) return;
        const info = keyElements[semitone];
        const barH = Math.max(10, (sp.tEnd-sp.tStart)*speed);
        const bottomY = canvasH + (elapsed - sp.tStart)*speed;
        const topY = bottomY - barH;
        if(bottomY<0 || topY>canvasH) return;
        vizCtx.globalAlpha = 0.9;
        vizCtx.fillStyle = info.hand==='r' ? '#5c8f8a' : '#c9a24a';
        drawRoundRect(vizCtx, info.x+2, Math.max(0,topY), info.w-4, Math.min(canvasH,bottomY)-Math.max(0,topY), 4);
        vizCtx.fill();
      });
    }

    liveTrailsById.forEach((tr, id)=>{
      const semitone = semitoneAndVisibleForMidi(tr.baseMidi);
      if(semitone==null){ if(tr.endPerf && nowPerf-tr.endPerf>600) liveTrailsById.delete(id); return; }
      const info = keyElements[semitone];
      const speed = 70;
      const endT = tr.endPerf!=null ? tr.endPerf : nowPerf;
      let h = Math.min(canvasH, (endT - tr.startPerf)/1000*speed);
      let alpha = 0.85;
      if(tr.endPerf!=null){
        const fade = (nowPerf-tr.endPerf)/500;
        alpha = Math.max(0, 0.85*(1-fade));
        if(fade>=1){ liveTrailsById.delete(id); return; }
      }
      vizCtx.globalAlpha = alpha;
      vizCtx.fillStyle = info.hand==='r' ? '#5c8f8a' : '#c9a24a';
      drawRoundRect(vizCtx, info.x+2, canvasH-h, info.w-4, h, 4);
      vizCtx.fill();
    });
    vizCtx.globalAlpha = 1;
  }

  // ---------- Init ----------
  buildKeyboard();
  renderLegend();
  requestAnimationFrame(renderViz);

  let resizeScheduled = false;
  function scheduleReflow(){
    if(resizeScheduled) return;
    resizeScheduled = true;
    requestAnimationFrame(()=>{ reflowKeyboard(); resizeScheduled = false; });
  }
  window.addEventListener('resize', scheduleReflow);
  window.addEventListener('orientationchange', scheduleReflow);

  const isTouchDevice = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
  if(isTouchDevice){
    document.getElementById('footerHint').textContent =
      'Tap the keys to play — drag across them for a glissando, and use two fingers for chords. Tap once anywhere to enable audio.';
  }
})();
