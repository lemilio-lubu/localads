"use client";

import { Building2, CircleCheck, FileText, KeyRound, Layers, LogIn, ShieldX, TriangleAlert, Users, type LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";
import TextButton from "../../components/atoms/text-button";
import EmptyAction from "../../components/atoms/empty-action";
import CopyCode from "../../components/molecules/copy-code";
import Disclosure from "../../components/molecules/disclosure";
import LoadError from "../../components/molecules/load-error";
import Pagination from "../../components/molecules/pagination";
import SearchField from "../../components/molecules/search-field";
import SegmentedFilter, { type SegmentOption } from "../../components/molecules/segmented-filter";
import { formatClock, formatDateTime, formatDay } from "../../lib/format";
import { describeDevice, describeEvent, describeIp, getSecurityEvents, type SecurityCategory, type SecurityEvent, type SecurityEventPage } from "../../lib/security-api";
import styles from "./security-dashboard.module.css";

const categorySegments: SegmentOption<SecurityCategory | null>[] = [
  { value: null, label: "todos", Icon: Layers, tone: "neutral" },
  { value: "access", label: "accesos", Icon: LogIn, tone: "brand" },
  { value: "credentials", label: "contraseñas", Icon: KeyRound, tone: "brand" },
  { value: "team", label: "equipo", Icon: Users, tone: "teal" },
  { value: "clients", label: "clientes", Icon: Building2, tone: "teal" },
  { value: "receipts", label: "comprobantes", Icon: FileText, tone: "amber" },
];
const outcomeSegments: SegmentOption<boolean>[] = [
  { value: false, label: "todos", Icon: Layers, tone: "neutral" },
  { value: true, label: "fallidos y denegados", Icon: TriangleAlert, tone: "amber" },
];

/* El resultado se dice con icono y color, y con palabras para quien no ve
   el color (lector de pantalla y tooltip). */
const outcomes: Record<string, { label: string; Icon: LucideIcon }> = {
  SUCCESS: { label: "Correcto", Icon: CircleCheck },
  FAILURE: { label: "Fallido", Icon: TriangleAlert },
  DENIED: { label: "Bloqueado por seguridad", Icon: ShieldX },
};

/* «Hoy», «Ayer» o la fecha: la lista viene de la más reciente a la más antigua. */
function groupByDay(events: SecurityEvent[]) {
  const key = (date: Date) => `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
  const today = new Date(); const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  const groups: { day: string; events: SecurityEvent[] }[] = [];
  for (const event of events) {
    const date = new Date(event.occurredAt);
    const day = key(date) === key(today) ? "Hoy" : key(date) === key(yesterday) ? "Ayer" : formatDay(event.occurredAt);
    if (groups.at(-1)?.day === day) groups.at(-1)!.events.push(event); else groups.push({ day, events: [event] });
  }
  return groups;
}

/* Qué pasó, quién, sobre quién y desde dónde: el registro de seguridad de
   toda la plataforma, solo lectura. Filtra y pagina el servidor porque crece
   sin parar (un login es una fila). */
export default function SecurityDashboard() {
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<SecurityCategory | null>(null);
  const [problemsOnly, setProblemsOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [reloadToken, setReloadToken] = useState(0);
  /* Cada respuesta recuerda qué consulta la produjo: «cargando» es que la
     última que llegó no es la que se está pidiendo. Así no hay un indicador
     que encender y apagar a mano en cada filtro. */
  const requested = JSON.stringify({ category, problemsOnly, search, page, reloadToken });
  const [result, setResult] = useState<{ key: string; data: SecurityEventPage | null; error: string } | null>(null);
  const loading = result?.key !== requested || query !== search;
  const data = result?.data ?? null; const error = result?.key === requested ? result.error : "";

  /* La búsqueda va al servidor: espera a que se deje de escribir. */
  useEffect(() => {
    const timer = window.setTimeout(() => { setSearch(query); setPage(1); }, 300);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    let active = true;
    const key = JSON.stringify({ category, problemsOnly, search, page, reloadToken });
    getSecurityEvents({ category, problemsOnly, search, page })
      .then((loaded) => { if (active) setResult({ key, data: loaded, error: "" }); })
      .catch((reason: unknown) => { if (active) setResult((current) => ({ key, data: current?.data ?? null, error: reason instanceof Error ? reason.message : "No fue posible consultar el registro de seguridad" })); });
    return () => { active = false; };
  }, [category, problemsOnly, search, page, reloadToken]);

  const hasFilters = Boolean(search.trim() || category || problemsOnly);
  function change(update: () => void) { update(); setPage(1); }
  function clearFilters() { change(() => { setQuery(""); setSearch(""); setCategory(null); setProblemsOnly(false); }); }
  function retry() { setReloadToken((token) => token + 1); }

  const items = data?.items ?? [];
  return (
    <div className={styles.module}>
      <div className={styles.toolbar}>
        <SearchField value={query} onChange={setQuery} placeholder="Buscar por persona, cliente o código de referencia" placeholderTone="strong" />
      </div>
      <div className={styles.filters}>
        <div className={styles.filterGroup}><span>tipo</span><SegmentedFilter label="Tipo de evento" options={categorySegments} value={category} onChange={(value) => change(() => setCategory(value))} /></div>
        <div className={styles.filterGroup}><span>resultado</span><SegmentedFilter label="Resultado" options={outcomeSegments} value={problemsOnly} onChange={(value) => change(() => setProblemsOnly(value))} /></div>
      </div>

      {!loading && !error && items.length > 0 && <div className={styles.listMeta}>
        <span>{data?.total} {data?.total === 1 ? "evento" : "eventos"}</span>
        {hasFilters && <TextButton onClick={clearFilters}>limpiar filtros</TextButton>}
      </div>}

      <div className={styles.listArea} aria-live="polite" aria-busy={loading}>
        {!loading && !error && groupByDay(items).map(({ day, events }) => (
          <section key={day} className={styles.day} aria-label={day}>
            <h3>{day}</h3>
            <ol className={styles.list}>
              {events.map((event) => {
                const { title, detail } = describeEvent(event, data?.people ?? {});
                const outcome = outcomes[event.outcome] ?? outcomes.FAILURE;
                const device = describeDevice(event.userAgent);
                const ip = describeIp(event.ip);
                return (
                  <li key={event.id} className={styles.event} data-outcome={event.outcome}>
                    <span className={styles.icon} role="img" aria-label={outcome.label} title={outcome.label}><outcome.Icon size={18} strokeWidth={2.25} aria-hidden="true" /></span>
                    <div className={styles.body}>
                      <p className={styles.title}>{title}</p>
                      {detail && <p className={styles.detail}>{detail}</p>}
                      {(ip || device || event.requestId) && <Disclosure summary="ver detalles" className={styles.more} summaryClassName={styles.moreSummary}>
                        <dl className={styles.facts}>
                          {ip && <div><dt>Desde la IP</dt><dd>{ip}</dd></div>}
                          {device && <div><dt>Navegador</dt><dd>{device}</dd></div>}
                          {event.requestId && <div><dt>Código de referencia</dt><dd><CopyCode code={event.requestId.slice(0, 8)} size="small" mono /></dd></div>}
                        </dl>
                      </Disclosure>}
                    </div>
                    <time className={styles.time} dateTime={event.occurredAt} title={formatDateTime(event.occurredAt)}>{formatClock(new Date(event.occurredAt))}</time>
                  </li>
                );
              })}
            </ol>
          </section>
        ))}

        {loading && <div className={styles.skeleton} aria-hidden="true" />}
        {!loading && error && <LoadError title="No se pudo cargar el registro de seguridad" message={error} frame="card" onRetry={retry} />}
        {!loading && !error && !items.length && (hasFilters
          ? <div className={styles.message}><p><strong>Ningún evento coincide con estos filtros</strong></p><EmptyAction onClick={clearFilters}>limpiar filtros</EmptyAction></div>
          : <div className={styles.message}><p><strong>Todavía no hay eventos</strong></p><p>Aquí aparecerán los accesos y los cambios de permisos a medida que ocurran.</p></div>)}
      </div>

      {!error && data && <Pagination page={data.page} totalPages={data.totalPages} disabled={loading} label="Páginas del registro de seguridad" onChange={setPage} />}
    </div>
  );
}
