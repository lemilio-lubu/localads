import type { NextConfig } from "next";

const apiUrl = new URL(process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api/v1");
const apiBasePath = apiUrl.pathname.replace(/\/$/, "");

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
