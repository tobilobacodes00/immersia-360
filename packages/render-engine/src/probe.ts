import { ALL_FORMATS, BlobSource, EncodedPacketSink, Input, type InputVideoTrack, type Rotation } from 'mediabunny';

/** Everything the renderer needs to know about a take before decoding a single frame. */
export interface TakeProbe {
  input: Input<BlobSource>;
  video: InputVideoTrack;
  /** Presentation timestamps of every frame, seconds from the first frame, ascending. */
  pts: Float64Array;
  /** Absolute timestamp of the first frame (container time), seconds. */
  firstTimestamp: number;
  durationS: number;
  /** Average real frame rate (120/240 for imported slow-motion clips). */
  fps: number;
  codec: string | null;
  width: number;
  height: number;
  rotation: Rotation;
  hasAudio: boolean;
  /** False when this browser can't decode the codec (e.g. HEVC on some Linux Chrome). */
  decodable: boolean;
  /** The WebCodecs decoder config this take needs (codec string, colour space), for diagnostics. */
  decoderCodec: string | null;
}

export class ProbeError extends Error {
  constructor(
    readonly code: 'unreadable' | 'no_video' | 'empty' | 'undecodable',
    message: string,
  ) {
    super(message);
    this.name = 'ProbeError';
  }
}

/**
 * Read container metadata and the packet index (no decoding), so the timeline can be resolved
 * against the take's REAL frame times. MediaRecorder output is variable-frame-rate; assuming a
 * constant rate would misplace slow-motion frames.
 */
export async function probeTake(blob: Blob): Promise<TakeProbe> {
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
  if (!(await input.canRead().catch(() => false))) throw new ProbeError('unreadable', 'Unsupported or damaged file');
  const video = await input.getPrimaryVideoTrack();
  if (!video) throw new ProbeError('no_video', 'The file has no video track');

  const stamps: number[] = [];
  const sink = new EncodedPacketSink(video);
  for await (const packet of sink.packets(undefined, undefined, { metadataOnly: true })) stamps.push(packet.timestamp);
  if (stamps.length === 0) throw new ProbeError('empty', 'The video track has no frames');
  stamps.sort((a, b) => a - b);

  const firstTimestamp = stamps[0]!;
  const pts = Float64Array.from(stamps, (t) => t - firstTimestamp);
  const lastDuration = stamps.length > 1 ? pts[pts.length - 1]! - pts[pts.length - 2]! : 1 / 30;
  const durationS = pts[pts.length - 1]! + lastDuration;
  const fps = stamps.length > 1 ? (stamps.length - 1) / pts[pts.length - 1]! : 30;

  const decodable = await video.canDecode().catch(() => false);
  const decoderCodec = await video
    .getDecoderConfig()
    .then((c) => (c ? `${c.codec} ${JSON.stringify(c.colorSpace ?? {})}` : null))
    .catch((err: unknown) => `error: ${err instanceof Error ? err.message : String(err)}`);
  const audio = await input.getPrimaryAudioTrack();
  return {
    input,
    video,
    pts,
    firstTimestamp,
    durationS,
    fps,
    codec: await video.getCodec(),
    width: await video.getSquarePixelWidth(),
    height: await video.getSquarePixelHeight(),
    rotation: await video.getRotation(),
    hasAudio: Boolean(audio),
    decodable,
    decoderCodec,
  };
}
