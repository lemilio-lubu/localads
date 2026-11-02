import type { NextConfig } from "next";

const apiUrl = new URL(process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api/v1");
const apiBasePath = apiUrl.pathname.replace(/\/$/, "");
const realtimeUrl = new URL(process.env.NEXT_PUBLIC_WS_URL ?? `${apiUrl.origin}/transactions`);
const realtimeOrigins = [realtimeUrl.origin, `${realtimeUrl.protocol === "https:" ? "wss" : "ws"}://${realtimeUrl.host}`];
const production = process.env.NODE_ENV === "production";

/* La API se llama por el proxy de abajo (mismo origen); solo el tiempo real
   va directo a la API. Los comprobantes y facturas se ven como blob: (imagen
   o PDF en un iframe). Next inyecta scripts y estilos en linea, de ahi
   'unsafe-inline'; en desarrollo el recargado en caliente pide ademas eval.
   Va en Report-Only: avisa en consola sin bloquear hasta confirmar en
   produccion que no rompe nada; luego se cambia la cabecera. */
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${production ? "" : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self' ${realtimeOrigins.join(" ")}`,
  "frame-src 'self' blob:",
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy-Report-Only", value: contentSecurityPolicy },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  /* HSTS solo compilado para produccion: en localhost por http no aplica y
     fijarlo ahi obligaria al navegador a https en el puerto equivocado. Sin
     includeSubDomains: no sabemos que otros subdominios comparten dominio. */
  ...(production ? [{ key: "Strict-Transport-Security", value: "max-age=31536000" }] : []),
];

const nextConfig: NextConfig = {
  /* Los accesos de prueba del login solo se compilan si se pide expresamente.
     Con el valor siempre definido ("true" o "false"), Next lo sustituye por un
     literal al compilar y el compilador elimina el código y los datos de los
     accesos de prueba del JavaScript de producción. Sin esto, una variable sin
     definir queda como lectura en el navegador y el código viaja aunque no se
     muestre. Ver login-form.tsx. */
  env: {
    NEXT_PUBLIC_SHOW_DEMO_ACCOUNTS: process.env.NEXT_PUBLIC_SHOW_DEMO_ACCOUNTS === "true" ? "true" : "false",
  },
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  async rewrites() {
    return [
      {
        source: "/api/v1/:path*",
        destination: `${apiUrl.origin}${apiBasePath}/:path*`,
      },
    ];
  },
};

export default nextConfig;
