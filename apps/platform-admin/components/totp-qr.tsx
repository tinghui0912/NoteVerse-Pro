"use client";
import { useMemo } from "react";
import qrcode from "qrcode-generator";

export function TotpQr({ uri }: { uri: string }) {
  const { size, path } = useMemo(() => {
    const qr = qrcode(0, "M");
    qr.addData(uri, "Byte");
    qr.make();
    const count = qr.getModuleCount();
    const cells: string[] = [];
    for (let row = 0; row < count; row++)
      for (let col = 0; col < count; col++) {
        if (qr.isDark(row, col)) cells.push(`M${col + 4},${row + 4}h1v1h-1z`);
      }
    return { size: count + 8, path: cells.join("") };
  }, [uri]);
  return (
    <svg
      role="img"
      aria-label="Authenticator enrollment QR code"
      viewBox={`0 0 ${size} ${size}`}
      className="totp-qr"
      shapeRendering="crispEdges"
    >
      <rect width={size} height={size} fill="white" />
      <path d={path} fill="black" />
    </svg>
  );
}
