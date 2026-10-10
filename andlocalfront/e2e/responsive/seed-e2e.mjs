/* Crea los datos que la suite responsive necesita ver, a través de la API y
   con los usuarios del seed, contra un backend que use la base de
   prepare-e2e-db.sh. Nunca contra la de desarrollo: escribe transacciones,
   comprobantes y solicitudes de verdad.

     node e2e/responsive/seed-e2e.mjs   (E2E_API_URL, por defecto :3001) */
const API = process.env.E2E_API_URL ?? "http://localhost:3001/api/v1";
const PASSWORD = "1234";

/* Un PNG de 1×1: basta para que el backend acepte el comprobante. */
const RECEIPT = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=", "base64");

async function call(path, { token, ...init } = {}) {
  const response = await fetch(`${API}${path}`, { ...init, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...init.headers } });
  const body = await response.text();
  if (!response.ok) throw new Error(`${init.method ?? "GET"} ${path} → ${response.status}: ${body.slice(0, 200)}`);
  return body ? JSON.parse(body) : null;
}

async function login(username) {
  const { accessToken, user } = await call("/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password: PASSWORD }) });
  return { token: accessToken, user };
}

const key = () => crypto.randomUUID();
const lines = (pautas, amounts) => pautas.slice(0, amounts.length).map((pauta, index) => ({ pautaId: pauta.id, platform: pauta.platform, amount: amounts[index].toFixed(2) }));

async function activePautas(token) {
  const pautas = await call("/me/pautas", { token });
  return pautas.filter((pauta) => pauta.status === "ACTIVE");
}

/* Prepago: cada recarga lleva comprobante y genera su verificación. Importes
   variados, de una a siete cifras, para ver cómo se parten. */
const prepago = await login("prepago");
const prepagoPautas = await activePautas(prepago.token);
for (const amounts of [[3], [158, 42.5], [890], [12], [1234567.89], [200, 15]]) {
  const body = new FormData();
  body.append("accountId", prepago.user.accountId);
  body.append("details", JSON.stringify(lines(prepagoPautas, amounts)));
  body.append("receipt", new Blob([RECEIPT], { type: "image/png" }), "comprobante-transferencia-pichincha.png");
  await call("/transactions/prepaid", { token: prepago.token, method: "POST", headers: { "Idempotency-Key": key() }, body });
}

/* Flex: recargas a crédito, sin comprobante. Si el backend no puede
   reservar el crédito, se avisa y se sigue: la suite mide igual el resto, y
   las facturas de Flex quedan en su estado vacío. */
const flex = await login("flex");
const flexPautas = await activePautas(flex.token);
let flexCreated = 0;
for (const amounts of [[150], [800, 60]]) {
  try {
    await call("/transactions/postpaid", { token: flex.token, method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": key() }, body: JSON.stringify({ accountId: flex.user.accountId, details: lines(flexPautas, amounts) }) });
    flexCreated++;
  } catch (error) {
    console.warn(`Aviso: no se pudo crear una recarga Flex (${error.message}).`);
  }
}

/* Una solicitud de activación pendiente, desde Flex. Prepago se queda sin
   ninguna: así su botón de TikTok sigue libre y el modal de activación se
   puede abrir. */
await call("/campaign-activation-requests", { token: flex.token, method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accountId: flex.user.accountId, platform: "TIKTOK", requesterName: "María Fernanda Villacís Andrade", externalAccountId: "7398126450918273645", phone: "+593987654321", firstRechargeAmount: "250.00" }) });

/* Un segundo gestor: la suite lo usa para abrir el modal de credenciales. */
const admin = await login("admin");
await call("/admin/team", { token: admin.token, method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "miguel", role: "GESTOR" }) });

console.log(`Datos de la suite responsive creados: 6 recargas prepago, ${flexCreated} flex, 1 solicitud de activación y el gestor «miguel».`);
