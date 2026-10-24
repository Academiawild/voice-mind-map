export function downsampleTo16k(input: Float32Array, inputSampleRate: number): Int16Array {
  if (inputSampleRate === 16000) {
    const direct = new Int16Array(input.length);
    for (let index = 0; index < input.length; index += 1) {
      const sample = Math.max(-1, Math.min(1, input[index] ?? 0));
      direct[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
    }
    return direct;
  }

  const sampleRateRatio = inputSampleRate / 16000;
  const outputLength = Math.max(1, Math.round(input.length / sampleRateRatio));
  const output = new Int16Array(outputLength);

  let offsetOutput = 0;
  let offsetInput = 0;

  while (offsetOutput < outputLength) {
    const nextOffsetInput = Math.min(
      input.length,
      Math.round((offsetOutput + 1) * sampleRateRatio),
    );
    let accumulator = 0;
    let count = 0;

    for (let index = offsetInput; index < nextOffsetInput; index += 1) {
      accumulator += input[index] ?? 0;
      count += 1;
    }

    const sample = count > 0 ? accumulator / count : 0;
    const clipped = Math.max(-1, Math.min(1, sample));
    output[offsetOutput] = clipped < 0 ? clipped * 0x8000 : clipped * 0x7fff;

    offsetOutput += 1;
    offsetInput = nextOffsetInput;
  }

  return output;
}

export function pcm16ToLittleEndianBuffer(input: Int16Array): ArrayBuffer {
  const view = new DataView(new ArrayBuffer(input.length * 2));
  for (let index = 0; index < input.length; index += 1) {
    view.setInt16(index * 2, input[index] ?? 0, true);
  }
  return view.buffer;
}
