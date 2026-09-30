"use client";

import { useEffect, useRef, useState } from "react";
import { cameraConstraints, cameraSetting, nativeDetector, scanFormats, type CameraCapabilities, type DetectorConstructor, type ScanMode } from "@/lib/barcode-camera";

export function BarcodeScanner({ onRead, mode = "barcode" }: { onRead: (code: string) => void; mode?: ScanMode }) {
  const [active, setActive] = useState(false);
  const [error, setError] = useState("");
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [cameraId, setCameraId] = useState("");
  const [torchAvailable, setTorchAvailable] = useState(false);
  const [torch, setTorch] = useState(false);
  const [zoomRange, setZoomRange] = useState<CameraCapabilities["zoom"]>();
  const [zoom, setZoom] = useState(1);
  const [adjusting, setAdjusting] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const trackRef = useRef<MediaStreamTrack | null>(null);
  const adjustingTrack = useRef<MediaStreamTrack | null>(null);
  const stopRef = useRef<(() => void) | null>(null);
  const callback = useRef(onRead);
  useEffect(() => { callback.current = onRead; }, [onRead]);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    let stream: MediaStream | undefined;
    let controls: { stop(): void } | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let fallbackTimer: ReturnType<typeof setTimeout> | undefined;
    let fallbackStarted = false;
    const preview = video.current!;
    const stopDecoder = (decoder: { stop(): void } | undefined) => {
      // Some ZXing controls return a promise while switching off the torch.
      try { void Promise.resolve(decoder?.stop()).catch(() => {}); } catch {}
    };
    const stop = () => {
      cancelled = true;
      clearTimeout(timer);
      clearTimeout(fallbackTimer);
      stopDecoder(controls);
      stream?.getTracks().forEach(track => track.stop());
      if (preview.srcObject === stream) preview.srcObject = null;
      if (trackRef.current && stream?.getTracks().includes(trackRef.current)) trackRef.current = null;
    };
    stopRef.current = stop;
    const close = () => { stop(); setActive(false); };
    const hide = () => { if (document.hidden) close(); };
    const fail = () => {
      if (cancelled) return;
      close();
      setError("No se pudo abrir la cámara. Permite su acceso y usa HTTPS (o localhost). También puedes escribir el código o utilizar un lector USB.");
    };
    const accept = (code: string) => {
      if (cancelled || !code) return;
      close();
      callback.current(code);
    };
    document.addEventListener("visibilitychange", hide);
    setTorchAvailable(false); setTorch(false); setZoomRange(undefined); setAdjusting(false);

    async function fallback() {
      if (cancelled || fallbackStarted) return;
      fallbackStarted = true;
      clearTimeout(timer); clearTimeout(fallbackTimer);
      try {
        const { BrowserMultiFormatReader } = await import("@zxing/browser");
        const { BarcodeFormat, DecodeHintType } = await import("@zxing/library");
        if (cancelled) return;
        const hints = new Map();
        hints.set(DecodeHintType.POSSIBLE_FORMATS, scanFormats[mode].map(format => BarcodeFormat[format.toUpperCase() as keyof typeof BarcodeFormat]));
        hints.set(DecodeHintType.TRY_HARDER, true);
        const reader = new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 120, delayBetweenScanSuccess: 120 });
        const scanner = await reader.decodeFromStream(stream!, preview, (result, _error, current) => {
          if (cancelled || !result) return;
          stopDecoder(current);
          accept(result.getText());
        });
        // The camera may have closed while ZXing was preparing the video.
        if (cancelled) stopDecoder(scanner);
        else controls = scanner;
      } catch { fail(); }
    }

    void (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("camera");
        stream = await navigator.mediaDevices.getUserMedia(cameraId
          ? { ...cameraConstraints, video: { ...(cameraConstraints.video as MediaTrackConstraints), deviceId: { exact: cameraId } } }
          : cameraConstraints);
        if (cancelled) { stop(); return; }
        const track = stream.getVideoTracks()[0];
        trackRef.current = track;
        const capabilities = track.getCapabilities?.() as CameraCapabilities | undefined;
        if (capabilities?.focusMode?.includes("continuous")) {
          await track.applyConstraints(cameraSetting("focusMode", "continuous")).catch(() => {});
        }
        if (cancelled) return;
        setTorchAvailable(!!capabilities?.torch);
        if (capabilities?.zoom && capabilities.zoom.max > capabilities.zoom.min) {
          const range = capabilities.zoom;
          const current = (track.getSettings() as MediaTrackSettings & { zoom?: number }).zoom ?? range.min;
          setZoomRange({ min: range.min, max: Math.min(range.max, Math.max(3, range.min, current)), step: range.step || 0.1 });
          setZoom(current);
        }
        // Device enumeration is optional and must not delay decoding.
        void navigator.mediaDevices.enumerateDevices?.().then(devices => {
          if (!cancelled) setCameras(devices.filter(device => device.kind === "videoinput"));
        }).catch(() => {});
        preview.srcObject = stream;
        await preview.play();
        if (cancelled) return;

        // Also covers a stalled native detector: ZXing takes over on the same stream.
        fallbackTimer = setTimeout(() => { void fallback(); }, 8000);
        const detector = await nativeDetector((window as Window & { BarcodeDetector?: DetectorConstructor }).BarcodeDetector, mode);
        if (cancelled || fallbackStarted) return;
        if (!detector) { await fallback(); return; }
        let failures = 0;
        const scan = async () => {
          if (cancelled || fallbackStarted) return;
          if (preview.readyState >= 2) {
            try {
              const results = await detector.detect(preview);
              if (cancelled || fallbackStarted) return;
              failures = 0;
              const value = results.find(result => result.rawValue)?.rawValue;
              if (value) { accept(value); return; }
            } catch {
              if (cancelled || fallbackStarted) return;
              if (++failures >= 3) { await fallback(); return; }
            }
          }
          timer = setTimeout(() => { void scan(); }, 100);
        };
        await scan();
      } catch { fail(); }
    })();
    return () => {
      stop();
      if (stopRef.current === stop) stopRef.current = null;
      document.removeEventListener("visibilitychange", hide);
    };
  }, [active, cameraId, mode]);

  async function adjustCamera(key: "torch" | "zoom", value: boolean | number) {
    const track = trackRef.current;
    if (!track || adjustingTrack.current === track) return;
    adjustingTrack.current = track;
    setAdjusting(true); setError("");
    try {
      await track.applyConstraints(cameraSetting(key, value));
      if (trackRef.current !== track) return;
      if (key === "torch") setTorch(Boolean(value));
      else setZoom(Number(value));
    } catch {
      if (trackRef.current === track) setError("La cámara no permite ese ajuste. Puedes seguir escaneando sin él.");
    } finally {
      if (adjustingTrack.current === track) adjustingTrack.current = null;
      if (trackRef.current === track) setAdjusting(false);
    }
  }

  return <div className="ec-stack ec-scanner">
    <button className="ec-btn" type="button" onClick={() => {
      setError("");
      if (active) stopRef.current?.();
      setActive(!active);
    }}>{active ? "Cerrar cámara" : "Leer con la cámara"}</button>
    {active && <>
      {cameras.length > 1 && <label className="ec-label"><span>Cámara</span>
        <select className="ec-select" value={cameraId} onChange={event => { stopRef.current?.(); setError(""); setCameraId(event.target.value); }}>
          <option value="">Trasera automática</option>
          {cameras.map((camera, index) => <option key={camera.deviceId} value={camera.deviceId}>{camera.label || `Cámara ${index + 1}`}</option>)}
        </select>
      </label>}
      <div className="ec-scanner-preview">
        <video key={`${cameraId}:${mode}`} ref={video} className="ec-barcode-video" autoPlay muted playsInline aria-label={mode === "qr" ? "Cámara para leer QR" : "Cámara para leer códigos de barras"} />
        <div className={`ec-scanner-guide${mode === "qr" ? " is-qr" : ""}`} aria-hidden="true" />
      </div>
      <p className="ec-help" role="status">{mode === "qr" ? "Centra el QR completo." : "Centra el código completo, dejando margen a los lados."} Si está borroso, aleja un poco la cámara y evita reflejos.</p>
      {(torchAvailable || zoomRange) && <div className="ec-scanner-controls">
        {torchAvailable && <button type="button" className="ec-btn" disabled={adjusting} aria-pressed={torch} onClick={() => { void adjustCamera("torch", !torch); }}>{torch ? "Apagar linterna" : "Encender linterna"}</button>}
        {zoomRange && <label className="ec-label"><span>Zoom: {zoom.toFixed(1)}x</span>
          <input type="range" min={zoomRange.min} max={zoomRange.max} step={zoomRange.step} value={zoom} disabled={adjusting} onChange={event => { void adjustCamera("zoom", Number(event.target.value)); }} />
        </label>}
      </div>}
      <p className="ec-help">La imagen se procesa en tu dispositivo, no se envía al servidor.</p>
    </>}
    {error && <p className="ec-error" role="alert">{error}</p>}
  </div>;
}
