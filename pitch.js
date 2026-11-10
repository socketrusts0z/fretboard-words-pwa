/* YIN on a downsampled signal; no trained parameters. */
function detectPitch(input, sampleRate, options = {}) {
 let mean=0;for(const v of input)mean+=v;mean/=input.length;
 let energy=0;for(const v of input)energy+=(v-mean)**2;
 const rms=Math.sqrt(energy/input.length);if(rms<(options.minRms ?? 0.0007))return null;
 // Average adjacent samples before decimation to reduce work and high-frequency noise.
 const stride=Math.max(1,Math.floor(sampleRate/12000)),rate=sampleRate/stride;
 const x=new Float32Array(Math.floor(input.length/stride));
 for(let i=0;i<x.length;i++){let sum=0;for(let j=0;j<stride;j++)sum+=input[i*stride+j]-mean;x[i]=sum/stride;}
 const min=Math.max(2,Math.floor(rate/1400)),max=Math.min(Math.ceil(rate/65),Math.floor(x.length/2)-2),n=Math.min(x.length-max,Math.floor(rate*.075));
 const diff=new Float32Array(max+2);let sum=0;
 for(let t=1;t<=max+1;t++){let d=0;for(let i=0;i<n;i++){const z=x[i]-x[i+t];d+=z*z;}sum+=d;diff[t]=sum?d*t/sum:1;}
 let tau=-1;
 for(let t=min;t<=max;t++)if(diff[t]<.18){while(t<max&&diff[t+1]<diff[t])t++;tau=t;break;}
 // A moderately noisy pluck may miss the strict threshold but still have a clear period.
 if(tau<0){let best=min;for(let t=min+1;t<=max;t++)if(diff[t]<diff[best])best=t;if(diff[best]<.30&&best>min&&best<max)tau=best;}
 if(tau<0)return null;
 const a=diff[tau-1],b=diff[tau],c=diff[tau+1],den=2*(a-2*b+c);
 const offset=den?Math.max(-.5,Math.min(.5,(a-c)/den)):0;
 return {frequency:rate/(tau+offset),confidence:1-b,rms};
}
if(typeof module!=='undefined')module.exports={detectPitch};
