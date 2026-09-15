# Recargas y plataformas — evaluación del 14 de septiembre de 2026

## Cambios visuales implementados

Referencias: [recargas en Figma](https://www.figma.com/design/VhgFhi9Yorvj3ZSQxwfJdk?node-id=1-121) y [modal de activación](https://www.figma.com/design/VhgFhi9Yorvj3ZSQxwfJdk?node-id=49-1875).

Se conservan el layout del portal, el ancho del panel, su padding de escritorio y móvil, las alturas mínimas de campos de recarga (58 px), adjunto (96 px) e inputs de activación (44 px). El modal utiliza el ancho de contenido existente del sistema (720 px como máximo), sin copiar las coordenadas absolutas del lienzo de Figma. Se mantienen los totales dinámicos y los estados de carga, error y confirmación que necesita la operación.

| Before | After | Why |
| --- | --- | --- |
| Formulario de activación debajo de recargas | Modal blanco, fondo desenfocado, marca y título en una cápsula, etiquetas bajo los campos | Seguir la composición de Figma sin desplazar el formulario de recargas |
| Campos con nombre de plataforma y badge «Activa» | Icono, moneda y monto en campos blancos redondeados | Recuperar la jerarquía visual de la referencia |
| Botón genérico de activación | Acción «desbloquea … local ads», rosa para TikTok | Identificar la plataforma y la acción |
| Adjunto con borde discontinuo y texto largo | Superficie blanca redondeada con texto «adjuntar comprobante» | Ajustar el componente al diseño |
| Errores de activación fuera del formulario | Mensaje dentro del modal, campos bloqueados durante el envío | Mantener el feedback junto a la acción |
| Tab del modal solo enumeraba botones y enlaces | También incluye inputs, selects y textareas | Permitir recorrer y editar el formulario con teclado |

La skill Emil Design orientó la respuesta al pulsar, las transiciones específicas y el respeto del movimiento reducido. Se reutilizaron ModalShell, ActionButton, los tokens y los assets existentes; el icono de TikTok para fondo blanco se descargó de Figma. Las variantes Meta y Google del modal adaptan la misma composición con los colores existentes del proyecto; la referencia suministrada muestra TikTok.

## Resultado funcional original

Evaluación basada en el código y las pruebas existentes. No se modificó el backend ni se ejecutaron cambios sobre clientes reales.

| Escenario | Resultado actual | Evidencia |
| --- | --- | --- |
| Administrador crea cliente con plataformas | Cumple: crea Campaign y Pauta ACTIVE | `andlocalback/src/modules/clients/infrastructure/prisma-client-admin.repository.ts`, método `create`; prueba de onboarding de fase 6 |
| Administrador agrega una plataforma a un cliente existente | No cumple: reemplaza Campaign, pero no crea ni activa Pauta | Mismo repositorio, método `update`, bloque `if (input.platforms)` |
| Administrador quita una plataforma | No cumple: borra Campaign, pero la Pauta puede seguir ACTIVE y disponible para recarga | `update` no modifica pautas; el front consulta `/me/pautas` |
| Cliente solicita una plataforma nueva | Cumple como solicitud: requiere decisión administrativa para activarse | `request-campaign-activation.ts`; protege ownership, cuenta activa y solicitudes duplicadas |
| Administrador aprueba la solicitud | Crea una Pauta ACTIVE, pero el listado administrativo no refleja esa plataforma | `prisma-campaign-activation.repository.ts`, método `approve`, escribe Pauta; `prisma-client-admin.repository.ts`, método `toView`, lee Campaign |
| Cambios administrativos mientras el cliente mantiene recargas abierto | No se actualizan automáticamente | `recharge-dashboard.tsx` carga pautas y solicitudes al montar; no tiene polling ni suscripción a eventos |
| Cliente intenta desbloquear una Pauta INACTIVE o SUSPENDED | El front permite abrir la solicitud, pero el backend devuelve `PAUTA_REACTIVATION_REQUIRED` | El front trata toda plataforma no ACTIVE como desbloqueable; el caso de uso rechaza cualquier pauta existente |
| Administrador quita todas las plataformas | No permitido actualmente | `client-form-modal.tsx` exige una selección; `client.dto.ts` exige `ArrayMinSize(1)` |

El cliente solicita activación; no se concede acceso directamente a sí mismo. La aprobación tampoco crea una recarga ni aprueba un pago: el monto inicial queda guardado en la solicitud. La prueba de persistencia verifica expresamente que no se crea transacción ni pago al aprobar.

### Corrección funcional propuesta

1. Usar Pauta como fuente de verdad de plataformas habilitadas tanto en cliente como en administración, y definir cómo mantener la compatibilidad con Campaign.
2. Aplicar las altas y bajas administrativas sobre Pauta en una transacción, preservando IDs, saldos e historial. Una baja debe cambiar estado y bloquear nuevas recargas.
3. Definir la reactivación de pautas existentes y qué ocurre con solicitudes pendientes cuando el administrador agrega o retira una plataforma.
4. Refrescar el cliente tras cambios administrativos y revalidar los importes seleccionados contra las plataformas vigentes.
5. Acordar si se permite un cliente sin plataformas y añadir pruebas de alta, baja, reactivación y concurrencia entre edición administrativa y aprobación de solicitudes.

## Verificaciones

- Frontend: `npm run lint` y `npm run build` completados correctamente, incluido TypeScript.
- Backend: 31 pruebas existentes aprobadas en `phase6-campaign-activation.spec.ts`, `phase6-prisma-campaign-activation.spec.ts` y `client-profile.spec.ts`.
- Esas pruebas no certifican el escenario completo: cubren el onboarding y las solicitudes, pero no resuelven la divergencia Campaign/Pauta en la edición administrativa.
- No se pudo verificar el render final ni la interacción en navegador: la herramienta de navegador informó que no hay ningún navegador disponible en esta sesión.

## Implementación completada

Se aplicaron las reglas acordadas posteriormente:

- `Pauta` es la fuente de verdad y `Campaign` queda sincronizada como proyección de compatibilidad.
- Una baja cambia la pauta a `INACTIVE`; conserva ID, cuenta externa, saldo e historial.
- El cliente puede solicitar la reactivación de la misma pauta mediante el modal de recargas.
- Una baja pone en `stop` cada detalle pendiente de esa plataforma y no modifica el pago.
- Las demás plataformas de una transacción pueden continuar.
- Reactivar una pauta no reanuda detalles en `stop`; el administrador debe hacerlo manualmente desde el detalle de la transacción.
- La reanudación vuelve a validar plataforma, cliente, cuenta, transacción y pago. También utiliza la versión del detalle para rechazar acciones sobre información desactualizada.
- Se aceptan clientes sin plataformas activas.
- Los cambios se publican por el canal en tiempo real existente; el front también recupera información al reconectar, enfocar la ventana y mediante una comprobación periódica.
- El arranque de la aplicación ya no reactiva las plataformas demo que habían sido dadas de baja.

Se añadieron migraciones para conservar varias solicitudes históricas de una pauta, registrar pausas por detalle y mantener una auditoría de activación, baja, reactivación, pausa y reanudación. La migración de compatibilidad alinea `Campaign` con las pautas existentes sin eliminar registros.

Verificación final: esquema Prisma válido, migraciones aplicadas, auditoría local con cero diferencias entre Pauta y Campaign, 273 pruebas del backend aprobadas, build de NestJS aprobado, lint y build de Next.js aprobados. La herramienta de navegador sigue sin ofrecer una instancia disponible, por lo que la validación visual interactiva debe realizarse cuando exista un navegador conectado.
