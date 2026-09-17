"use client";
import { DialogFocus } from "@/app/dashboard/dialog-focus";

import QRCode from "qrcode";
import { useEffect, useMemo, useState } from "react";

type QrModalProps = {
  label: string;
  path: string;
  title: string;
};

export function QrModal({ label, path, title }: QrModalProps) {
  const [open, setOpen] = useState(false);
  const [qrUrl, setQrUrl] = useState("");
  const targetUrl = useMemo(() => {
    if (typeof window === "undefined") return path;
    return new URL(path, window.location.origin).toString();
  }, [path]);

  useEffect(() => {
    if (!open) return;

    QRCode.toDataURL(targetUrl, {
      color: {
        dark: "#000000",
        light: "#ffffff"
      },
      errorCorrectionLevel: "M",
      margin: 4,
      width: 320
    })
      .then(setQrUrl)
      .catch(() => setQrUrl(""));
  }, [open, targetUrl]);

  return (
    <>
      <button className="ec-btn" aria-label={`${label}: ${title}`} onClick={() => setOpen(true)} type="button">
        QR
      </button>

      {open ? (
        <div className="ec-modal-backdrop" onClick={() => setOpen(false)} role="presentation">
          <div
            aria-modal="true"
            className="ec-modal ec-modal-narrow ec-qr-dialog"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          ><DialogFocus />
            <div className="ec-modal-header">
              <div className="ec-col">
                <div className="ec-muted-2">{label}</div>
                <h2 className="ec-h2">{title}</h2>
              </div>
              <button className="ec-btn ec-btn-ghost ec-qr-no-print" onClick={() => setOpen(false)} type="button">
                Cerrar
              </button>
            </div>
            <div className="ec-modal-body ec-stack">
              <div className="ec-qr-card">
                {qrUrl ? <img alt={`QR de ${title}`} src={qrUrl} /> : <span>Generando QR...</span>}
              </div>
              <div className="ec-qr-url">{targetUrl}</div>
              <div className="ec-actions ec-qr-no-print">
                <a className="ec-btn ec-btn-primary" download={`${title}-qr.png`} href={qrUrl}>
                  Descargar
                </a>
                <button className="ec-btn" onClick={() => window.print()} type="button">
                  Imprimir
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
