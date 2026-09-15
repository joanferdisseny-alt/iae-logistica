"use client";

import { useEffect, useRef, useState } from "react";

export function BarcodeScanner({ onRead }: { onRead: (code: string) => void }) {
  const [active,setActive]=useState(false);
  const [error,setError]=useState("");
  const video=useRef<HTMLVideoElement>(null);
  const callback=useRef(onRead);
  useEffect(()=>{callback.current=onRead;},[onRead]);
  useEffect(()=>{
    if(!active) return;
    let cancelled=false;
    let stream: MediaStream | undefined;
    let controls: {stop:()=>void} | undefined;
    const stop=()=>{controls?.stop(); stream?.getTracks().forEach(track=>track.stop());};
    const hide=()=>{if(document.hidden) setActive(false);};
    document.addEventListener("visibilitychange",hide);
    void (async()=>{
      try {
        if(!navigator.mediaDevices?.getUserMedia) throw new Error("camera");
        const {BrowserMultiFormatReader}=await import("@zxing/browser");
        if(cancelled) return;
        stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:"environment"}},audio:false});
        if(cancelled){stop();return;}
        controls=await new BrowserMultiFormatReader().decodeFromStream(stream,video.current!, (result,_error,current)=>{
          if(cancelled || !result) return;
          cancelled=true;
          current.stop(); stop(); setActive(false);
          callback.current(result.getText());
        });
        if(cancelled) stop();
      } catch {
        stop();
        if(!cancelled){setError("No se pudo abrir la cámara. Permite su acceso y usa HTTPS (o localhost). También puedes escribir el código o utilizar un lector USB.");setActive(false);}
      }
    })();
    return ()=>{cancelled=true;stop();document.removeEventListener("visibilitychange",hide);};
  },[active]);
  return <div className="ec-stack">
    <button className="ec-btn" type="button" onClick={()=>{setError("");setActive(!active);}}>{active?"Cerrar cámara":"Leer con la cámara"}</button>
    {active && <video ref={video} className="ec-barcode-video" autoPlay muted playsInline aria-label="Vista de la cámara para leer el código"/>}
    {error && <p className="ec-error" role="alert">{error}</p>}
  </div>;
}
