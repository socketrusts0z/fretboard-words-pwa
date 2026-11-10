/* Optional local microphone answers for guitar sessions. */
const guitarMic = { running:false, pending:false, generation:0, context:null, stream:null, frame:0, candidate:null, count:0, consumed:null, quietSince:0, last:0, ignoreUntil:0 };
function syncGuitarMic() {
  const active=isGuitarPractice()&&state.session?.status==='active';
  $('guitarMicPanel').hidden=!active;
  if(!active&&(guitarMic.running||guitarMic.pending))stopGuitarMic();
}
function stopGuitarMic() {
  guitarMic.generation++;guitarMic.pending=false;guitarMic.running=false;
  cancelAnimationFrame(guitarMic.frame);
  guitarMic.stream?.getTracks().forEach(track=>track.stop());
  guitarMic.context?.close().catch(()=>{});
  Object.assign(guitarMic,{stream:null,context:null,candidate:null,count:0,consumed:null});
  $('guitarMicToggle').disabled=false;$('guitarMicToggle').textContent='Enable microphone';
  $('guitarMicLevel').value=0;$('guitarMicReadout').textContent='Microphone off · fret taps still work.';
}
async function startGuitarMic() {
  if(guitarMic.pending)return;if(guitarMic.running){stopGuitarMic();return;}
  const generation=++guitarMic.generation;guitarMic.pending=true;$('guitarMicToggle').disabled=true;
  try {
    if(!navigator.mediaDevices?.getUserMedia)throw Error('Microphone requires HTTPS or localhost.');
    const context=new(window.AudioContext||window.webkitAudioContext)();guitarMic.context=context;
    await context.resume();
    const stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false},video:false});
    if(generation!==guitarMic.generation||!isGuitarPractice()){stream.getTracks().forEach(t=>t.stop());return;}
    guitarMic.stream=stream;
    const source=context.createMediaStreamSource(stream),analyser=context.createAnalyser(),mute=context.createGain();
    analyser.fftSize=8192;mute.gain.value=0;source.connect(analyser);analyser.connect(mute);mute.connect(context.destination);
    const samples=new Float32Array(8192);guitarMic.running=true;guitarMic.consumed=null;
    $('guitarMicToggle').textContent='Stop microphone';
    state.session.config.microphoneTimed=true;queueSave();updateTimer();
    function tick(now){
      if(!guitarMic.running)return;
      if(now-guitarMic.last>70){
        guitarMic.last=now;analyser.getFloatTimeDomainData(samples);
        let power=0;for(const x of samples)power+=x*x;const rms=Math.sqrt(power/samples.length);
        $('guitarMicLevel').value=Math.min(1,rms*16);
        const minRms={normal:.0007,high:.00025,maximum:.00008}[$('guitarMicSensitivity').value] ?? .00025;
        const p=detectPitch(samples,context.sampleRate,{minRms});
        if(!p){guitarMic.count=0;guitarMic.candidate=null;if(!guitarMic.quietSince)guitarMic.quietSince=now;if(now-guitarMic.quietSince>220)guitarMic.consumed=null;
          $('guitarMicReadout').textContent=rms<minRms?'Input very quiet · move closer to the microphone.':'Listening for a clear pitch · mute the other strings.';
        }else{
          guitarMic.quietSince=0;const midiFloat=69+12*Math.log2(p.frequency/440),midi=Math.round(midiFloat),cents=Math.round(100*(midiFloat-midi));
          guitarMic.count=guitarMic.candidate===midi?guitarMic.count+1:1;guitarMic.candidate=midi;
          $('guitarMicReadout').textContent=`Heard ${noteFor(midi)}${Math.floor(midi/12)-1} · ${p.frequency.toFixed(1)} Hz · ${cents>0?'+':''}${cents} cents`;
          if(guitarMic.count>=3&&Math.abs(cents)<40&&now>guitarMic.ignoreUntil&&guitarMic.consumed!==midi&&!state.locked&&state.word){
            const target=state.word.steps[state.index];
            const button=[...document.querySelectorAll('.fret-button')].find(b=>Number(b.dataset.midi)===midi&&b.dataset.inPractice==='true'&&b.dataset.note===target.note&&(target.stringOpen===null||Number(b.dataset.stringOpen)===target.stringOpen));
            if(button){guitarMic.consumed=midi;answer(button,'microphone');}
            else $('guitarMicReadout').textContent+=' · try the prompted note and octave';
          }else if(guitarMic.consumed===midi)$('guitarMicReadout').textContent+=' · mute briefly before repeating';
        }
      }
      guitarMic.frame=requestAnimationFrame(tick);
    }
    guitarMic.frame=requestAnimationFrame(tick);
  }catch(error){if(generation===guitarMic.generation){stopGuitarMic();$('guitarMicReadout').textContent=error.name==='NotAllowedError'?'Microphone denied. Allow access in browser settings, or use fret taps.':error.message;}}
  finally{if(generation===guitarMic.generation){guitarMic.pending=false;$('guitarMicToggle').disabled=false;}}
}
$('guitarMicToggle').addEventListener('click',startGuitarMic);
document.addEventListener('visibilitychange',()=>{if(document.hidden)stopGuitarMic();});
window.addEventListener('pagehide',stopGuitarMic);
