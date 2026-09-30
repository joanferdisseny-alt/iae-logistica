export type ScanMode = "barcode" | "qr";

export const cameraConstraints: MediaStreamConstraints = {
  audio: false,
  video: {
    facingMode: { ideal: "environment" },
    width: { ideal: 1920 },
    height: { ideal: 1080 },
    frameRate: { ideal: 30 }
  }
};

// These names also map to ZXing's BarcodeFormat enum when uppercased.
export const scanFormats = {
  barcode: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "code_93", "itf", "codabar"],
  qr: ["qr_code"]
} satisfies Record<ScanMode, string[]>;

type NativeDetector = { detect(source: HTMLVideoElement): Promise<Array<{ rawValue: string }>> };
export type DetectorConstructor = {
  new (options: { formats: string[] }): NativeDetector;
  getSupportedFormats(): Promise<string[]>;
};

export async function nativeDetector(ctor: DetectorConstructor | undefined, mode: ScanMode): Promise<NativeDetector | null> {
  if (!ctor) return null;
  try {
    const supported = await ctor.getSupportedFormats();
    if (!scanFormats[mode].every(format => supported.includes(format))) return null;
    return new ctor({ formats: scanFormats[mode] });
  } catch {
    return null;
  }
}

export type CameraCapabilities = MediaTrackCapabilities & {
  focusMode?: string[];
  torch?: boolean;
  zoom?: { min: number; max: number; step: number };
};

export function cameraSetting(key: "focusMode" | "torch" | "zoom", value: string | boolean | number): MediaTrackConstraints {
  return { advanced: [{ [key]: value } as MediaTrackConstraintSet] };
}
