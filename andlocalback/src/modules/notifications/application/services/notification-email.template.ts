/* Correo sencillo, sin imágenes remotas ni adjuntos: título, el mismo texto
   corto de la campana y un enlace a la app, donde se ve el detalle ya con
   sesión. Todo lo variable se escapa: el motivo de un rechazo lo escribe
   una persona. */

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char);

export type NotificationEmailContent = Readonly<{ title: string; body: string; url: string | null }>;

export function renderNotificationEmail(content: NotificationEmailContent): Readonly<{ subject: string; text: string; html: string }> {
  const footer = "Recibes este correo por los avisos de tu cuenta en AND Local Ads. Puedes apagarlos en la pantalla de avisos de tu perfil.";
  const text = [content.title, "", content.body, ...(content.url ? ["", `Ábrelo aquí: ${content.url}`] : []), "", footer].join("\n");
  const button = content.url
    ? `<p style="margin:24px 0 0"><a href="${escapeHtml(content.url)}" style="display:inline-block;background:#0b5901;color:#ffffff;text-decoration:none;font-weight:700;padding:12px 20px;border-radius:999px">Abrir en AND Local Ads</a></p>`
    : "";
  const html = `<!doctype html><html lang="es"><body style="margin:0;background:#f5f5f5;font-family:Arial,Helvetica,sans-serif;color:#1f1f1f">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:16px"><tr><td style="padding:32px">
<p style="margin:0 0 8px;color:#0b5901;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase">AND Local Ads</p>
<h1 style="margin:0;font-size:22px;line-height:1.3">${escapeHtml(content.title)}</h1>
<p style="margin:12px 0 0;font-size:15px;line-height:1.55;color:#4a4a4a">${escapeHtml(content.body)}</p>${button}
</td></tr></table>
<p style="max-width:520px;margin:16px 0 0;font-size:12px;line-height:1.5;color:#6b6b6b">${escapeHtml(footer)}</p>
</td></tr></table></body></html>`;
  return { subject: content.title, text, html };
}
