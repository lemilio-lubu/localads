/* Un despliegue es todo lo que no corre en la maquina de alguien: produccion
   y cualquier entorno de Railway (staging incluido), aunque olvide poner
   NODE_ENV=production. Antes un staging sin NODE_ENV firmaba los tokens con
   el secreto de desarrollo, que esta escrito en el repositorio. */
export function isDeployed(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV === "production" || Boolean(env.RAILWAY_ENVIRONMENT_NAME || env.RAILWAY_ENVIRONMENT);
}

const placeholderSecrets = new Set([
  "replace-with-at-least-32-random-bytes",
  "reemplazar-por-un-secreto-aleatorio-de-al-menos-32-caracteres",
  "development-only-change-this-jwt-secret",
]);

/* Se comprueba al arrancar y falla entero: es mejor que el despliegue no
   llegue a levantar a que levante con una configuracion insegura. */
export function environmentProblems(env: NodeJS.ProcessEnv = process.env): string[] {
  if (!isDeployed(env)) return [];
  const problems: string[] = [];
  const secret = env.JWT_ACCESS_SECRET ?? "";
  if (secret.length < 32 || placeholderSecrets.has(secret)) problems.push("JWT_ACCESS_SECRET debe ser un secreto aleatorio de al menos 32 caracteres");
  const origin = env.FRONTEND_ORIGIN?.trim();
  if (!origin) problems.push("FRONTEND_ORIGIN es obligatorio");
  else if (!/^https:\/\/[^/*\s]+$/.test(origin)) problems.push("FRONTEND_ORIGIN debe ser un unico origen https, sin comodines ni ruta");
  if (!env.DATABASE_URL?.trim()) problems.push("DATABASE_URL es obligatorio");
  const hops = env.TRUST_PROXY_HOPS;
  if (hops !== undefined && !/^\d+$/.test(hops)) problems.push("TRUST_PROXY_HOPS debe ser un entero");
  return problems;
}

export function assertSafeEnvironment(env: NodeJS.ProcessEnv = process.env) {
  const problems = environmentProblems(env);
  if (problems.length) throw new Error(`Configuracion insegura:\n- ${problems.join("\n- ")}`);
}

/* Cuantos proxies hay delante de la API. Con uno (el borde de Railway),
   req.ip es quien se conecto a ese borde y no se puede falsificar con una
   cabecera X-Forwarded-For. */
export const trustProxyHops = (env: NodeJS.ProcessEnv = process.env) =>
  env.TRUST_PROXY_HOPS !== undefined ? Number(env.TRUST_PROXY_HOPS) : isDeployed(env) ? 1 : 0;
