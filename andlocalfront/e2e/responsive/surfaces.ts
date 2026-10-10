import { expect, type Locator, type Page } from "@playwright/test";
import type { Role } from "./auth";

/* Una superficie es la unidad de la auditoría: una pantalla, o un modal
   abierto sobre ella. Cada una dice cómo llegar y cuándo está lista para
   medirse. */
export type Surface = {
  id: string;
  role: Role;
  path: string;
  /* Espera a que la pantalla haya pintado sus datos. */
  ready: (page: Page) => Promise<void>;
  /* Solo en modales: lo abre desde la pantalla ya lista. Devuelve `false` si
     los datos actuales no permiten abrirlo (por ejemplo, ninguna plataforma
     pendiente de activar) y el test se salta con ese motivo. */
  open?: (page: Page) => Promise<boolean>;
  /* Abrirlo escribe en la base de datos. Solo corre con
     RESPONSIVE_MUTATIONS=1, y solo contra la copia `e2e.db`. */
  mutates?: boolean;
  /* Antes de navegar (tras el login): intercepta la API para forzar un
     estado de error o de carga. */
  prepare?: (page: Page) => Promise<void>;
  /* Tras `ready`: lleva la pantalla a otro estado, como una búsqueda sin
     resultados. */
  interact?: (page: Page) => Promise<void>;
  /* Variante de estado (vacío, error, cargando): se mide en móvil, pero no
     entra en la línea base de escritorio. */
  state?: boolean;
};

const visible = (locator: Locator) => expect(locator.first()).toBeVisible({ timeout: 15_000 });
const button = (page: Page, name: string | RegExp) => page.getByRole("button", { name, exact: typeof name === "string" });

/* Un PNG de 1×1 basta para que el formulario de recarga acepte el comprobante. */
const RECEIPT = {
  name: "comprobante.png",
  mimeType: "image/png",
  buffer: Buffer.from("iVBORw0KGBgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=", "base64"),
};

/* Controles que un usuario no podría pulsar porque otro elemento los tapa.
   Se apuntan como hallazgo y se fuerza el clic para poder seguir auditando lo
   que hay detrás. */
const blocked = new WeakMap<Page, string[]>();
export const blockedTaps = (page: Page) => blocked.get(page) ?? [];

async function tap(locator: Locator) {
  try {
    await locator.click({ timeout: 5_000 });
  } catch {
    const page = locator.page();
    blocked.set(page, [...blockedTaps(page), String(locator)]);
    await locator.click({ force: true });
  }
}

async function clickFirstEnabled(locator: Locator) {
  const count = await locator.count();
  for (let index = 0; index < count; index++) {
    const candidate = locator.nth(index);
    if (await candidate.isEnabled()) { await tap(candidate); return true; }
  }
  return false;
}

/* Rellena el formulario de recarga lo justo para que «recargar» abra la
   confirmación. La recarga no se envía: eso pasa al deslizar, y no se desliza. */
async function openRechargeConfirm(page: Page, prepaid: boolean) {
  const amount = page.locator('input[id$="-amount"]').first();
  if (await amount.count() === 0) return false;
  await amount.fill("100");
  if (prepaid) await page.locator('input[type="file"]').setInputFiles(RECEIPT);
  await tap(page.getByText(/He leído términos/));
  await tap(button(page, "recargar"));
  return true;
}

function clientSurfaces(role: "prepago" | "flex"): Surface[] {
  const prepaid = role === "prepago";
  const recharge = async (page: Page) => { await visible(button(page, "recargar")); };
  const invoices = async (page: Page) => { await visible(page.getByText(/actualizado a las|sin recargas|no hay/i)); };
  return [
    { id: `${role}-recarga`, role, path: `/${role}`, ready: recharge },
    {
      id: `${role}-activacion`, role, path: `/${role}`, ready: recharge,
      open: (page) => clickFirstEnabled(page.locator('button[class*="activationButton"]')),
    },
    { id: `${role}-confirmacion`, role, path: `/${role}`, ready: recharge, open: (page) => openRechargeConfirm(page, prepaid) },
    { id: `${role}-activos`, role, path: `/${role}/activos`, ready: async (page) => { await visible(page.getByRole("button", { name: /Ver detalle de/ })); } },
    { id: `${role}-facturas`, role, path: `/${role}/facturas`, ready: invoices },
    {
      id: `${role}-factura-detalle`, role, path: `/${role}/facturas`, ready: invoices,
      open: (page) => clickFirstEnabled(button(page, "ver detalles")),
    },
  ];
}

const adminList = (text: string | RegExp) => async (page: Page) => { await visible(page.getByText(text)); };

export const surfaces: Surface[] = [
  { id: "login", role: "public", path: "/", ready: async (page) => { await visible(page.locator('input[name="username"]')); } },
  { id: "cambiar-contrasena", role: "prepago", path: "/cambiar-contrasena", ready: async (page) => { await visible(page.locator('input[type="password"]')); } },

  ...clientSurfaces("prepago"),
  ...clientSurfaces("flex"),

  { id: "admin-clientes", role: "admin", path: "/admin/clientes", ready: adminList("crear nuevo cliente") },
  {
    id: "admin-cliente-detalle", role: "admin", path: "/admin/clientes", ready: adminList("crear nuevo cliente"),
    open: (page) => clickFirstEnabled(page.getByRole("button", { name: /Ver detalle de/ })),
  },
  {
    id: "admin-cliente-form", role: "admin", path: "/admin/clientes", ready: adminList("crear nuevo cliente"),
    open: async (page) => { await tap(button(page, "crear nuevo cliente")); return true; },
  },
  { id: "admin-transacciones", role: "admin", path: "/admin/transacciones", ready: adminList(/actualizado a las/) },
  {
    id: "admin-transaccion-detalle", role: "admin", path: "/admin/transacciones", ready: adminList(/actualizado a las/),
    open: (page) => clickFirstEnabled(button(page, "ver detalles")),
  },
  { id: "admin-verificaciones", role: "admin", path: "/admin/verificaciones", ready: adminList(/actualizado a las/) },
  {
    id: "admin-verificacion-revision", role: "admin", path: "/admin/verificaciones", ready: adminList(/actualizado a las/),
    open: (page) => clickFirstEnabled(button(page, "revisar")),
  },
  { id: "admin-activaciones", role: "admin", path: "/admin/activaciones", ready: adminList(/actualizado a las/) },
  { id: "admin-equipo", role: "admin", path: "/admin/equipo", ready: adminList("crear cuenta") },
  {
    id: "admin-miembro-detalle", role: "admin", path: "/admin/equipo", ready: adminList("crear cuenta"),
    open: (page) => clickFirstEnabled(page.getByRole("button", { name: "Ver detalle de gestor", exact: true })),
  },
  {
    id: "admin-equipo-form", role: "admin", path: "/admin/equipo", ready: adminList("crear cuenta"),
    open: async (page) => { await tap(button(page, "crear cuenta")); return true; },
  },
  {
    /* Desactivar a un gestor con cartera abre el traspaso sin escribir nada:
       la baja solo ocurre al confirmar el destino de sus clientes. */
    id: "admin-traspaso", role: "admin", path: "/admin/equipo", ready: adminList("crear cuenta"),
    open: async (page) => {
      const row = page.locator("article").filter({ has: page.getByRole("button", { name: "Ver detalle de gestor", exact: true }) });
      return clickFirstEnabled(row.getByRole("button", { name: "desactivar" }));
    },
  },
  {
    id: "admin-credenciales", role: "admin", path: "/admin/equipo", ready: adminList("crear cuenta"), mutates: true,
    open: async (page) => {
      const row = page.locator("article").filter({ has: page.getByRole("button", { name: "Ver detalle de miguel", exact: true }) });
      return clickFirstEnabled(row.getByRole("button", { name: "restablecer" }));
    },
  },

  /* El diálogo de instalar la app (PWA): con <dialog> nativo, no ModalShell.
     Sin el evento de instalación del navegador, explica los pasos. */
  {
    id: "prepago-instalar", role: "prepago", path: "/prepago", ready: async (page) => { await visible(button(page, "recargar")); },
    open: async (page) => { await tap(page.getByRole("button", { name: /instalar/i }).first()); return true; },
  },
  {
    id: "admin-instalar", role: "admin", path: "/admin/clientes", ready: adminList("crear nuevo cliente"),
    open: async (page) => { await tap(page.getByRole("button", { name: /instalar/i }).first()); return true; },
  },

  /* El gestor ve las mismas pantallas que el admin; solo cambia la navegación
     (sin «equipo»), así que basta una para revisar su shell. */
  { id: "gestor-clientes", role: "gestor", path: "/admin/clientes", ready: adminList("crear nuevo cliente") },
];

/* ---- Estados: vacío, error y cargando de cada lista ---- */

const isData = (url: URL) => url.pathname.startsWith("/api/v1/") && !url.pathname.startsWith("/api/v1/auth/");
const failApi = async (page: Page) => { await page.route(isData, (route) => route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ message: "Error simulado por la suite responsive" }) })); };
/* La petición queda pendiente para siempre: la pantalla se queda cargando. */
const hangApi = async (page: Page) => { await page.route(isData, () => undefined); };
const settle = (ms: number) => async (page: Page) => { await page.waitForTimeout(ms); };
const errorShown = async (page: Page) => { await visible(page.getByRole("alert").or(page.getByText(/reintentar|no fue posible|no pudimos/i))); };
const searchNothing = async (page: Page) => {
  await page.getByPlaceholder(/^Buscar por/).first().fill("zzqx-sin-resultados");
  await page.waitForTimeout(800);
  await page.waitForLoadState("networkidle", { timeout: 3_000 }).catch(() => undefined);
};

const lists: { id: string; role: Surface["role"]; path: string; ready: Surface["ready"] }[] = [
  { id: "admin-clientes", role: "admin", path: "/admin/clientes", ready: adminList("crear nuevo cliente") },
  { id: "admin-transacciones", role: "admin", path: "/admin/transacciones", ready: adminList(/actualizado a las/) },
  { id: "admin-verificaciones", role: "admin", path: "/admin/verificaciones", ready: adminList(/actualizado a las/) },
  { id: "admin-activaciones", role: "admin", path: "/admin/activaciones", ready: adminList(/actualizado a las/) },
  { id: "admin-equipo", role: "admin", path: "/admin/equipo", ready: adminList("crear cuenta") },
  { id: "prepago-facturas", role: "prepago", path: "/prepago/facturas", ready: async (page) => { await visible(page.getByText(/actualizado a las/)); } },
];

for (const list of lists) {
  surfaces.push(
    { ...list, id: `${list.id}--vacio`, state: true, interact: searchNothing },
    { ...list, id: `${list.id}--error`, state: true, prepare: failApi, ready: errorShown },
    { ...list, id: `${list.id}--cargando`, state: true, prepare: hangApi, ready: settle(1_500) },
  );
}
surfaces.push(
  { id: "prepago-recarga--error", role: "prepago", path: "/prepago", state: true, prepare: failApi, ready: errorShown },
  { id: "prepago-recarga--cargando", role: "prepago", path: "/prepago", state: true, prepare: hangApi, ready: settle(1_500) },
  { id: "prepago-activos--error", role: "prepago", path: "/prepago/activos", state: true, prepare: failApi, ready: errorShown },
  { id: "prepago-activos--cargando", role: "prepago", path: "/prepago/activos", state: true, prepare: hangApi, ready: settle(1_500) },
);
