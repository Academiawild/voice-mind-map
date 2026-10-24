import { downsampleTo16k, pcm16ToLittleEndianBuffer } from '../../lib/audio';

export type PcmCapture = { close: () => Promise<void> };

const WORKLET_SOURCE = `
class VoiceMindMapPcmProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel && channel.length) this.port.postMessage(channel.slice(0));
    return true;
  }
}
registerProcessor('voice-mind-map-pcm', VoiceMindMapPcmProcessor);
`;

export async function createPcmCapture(input: {
  stream: MediaStream;
  onFrame: (buffer: ArrayBuffer) => void;
  onLevel: (peak: number) => void;
}): Promise<PcmCapture> {
  const context = new AudioContext();
  const source = context.createMediaStreamSource(input.stream);
  const mute = context.createGain();
  mute.gain.value = 0;
  let processor: AudioWorkletNode | ScriptProcessorNode;
  let objectUrl: string | null = null;

  const publish = (samples: Float32Array) => {
    let peak = 0;
    for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
    input.onLevel(peak);
    const pcm = downsampleTo16k(samples, context.sampleRate);
    if (pcm.length) input.onFrame(pcm16ToLittleEndianBuffer(pcm));
  };

  try {
    if (!context.audioWorklet || typeof AudioWorkletNode === 'undefined')
      throw new Error('no-worklet');
    objectUrl = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: 'text/javascript' }));
    await context.audioWorklet.addModule(objectUrl);
    const worklet = new AudioWorkletNode(context, 'voice-mind-map-pcm');
    worklet.port.onmessage = (event: MessageEvent<Float32Array>) => publish(event.data);
    processor = worklet;
  } catch {
    const fallback = context.createScriptProcessor(4096, 1, 1);
    fallback.onaudioprocess = (event) => publish(event.inputBuffer.getChannelData(0));
    processor = fallback;
  }

  source.connect(processor);
  processor.connect(mute);
  mute.connect(context.destination);

  return {
    close: async () => {
      processor.disconnect();
      source.disconnect();
      mute.disconnect();
      if ('port' in processor) processor.port.onmessage = null;
      if ('onaudioprocess' in processor) processor.onaudioprocess = null;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      if (context.state !== 'closed') await context.close();
    },
  };
}

export function createBlobRecorder(stream: MediaStream) {
  const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
    ? 'audio/webm;codecs=opus'
    : 'audio/webm';
  const recorder = new MediaRecorder(stream, { mimeType });
  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (event) => {
    if (event.data.size) chunks.push(event.data);
  };
  return {
    start: () => recorder.start(250),
    stop: () =>
      new Promise<Blob>((resolve, reject) => {
        recorder.onerror = () => reject(new Error('录音失败，请检查麦克风权限。'));
        recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }));
        recorder.stop();
      }),
    get state() {
      return recorder.state;
    },
  };
}
