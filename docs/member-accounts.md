# Usuarios y voluntarios: una persona, una cuenta

## Activacion en un proyecto existente

1. Haz una copia de seguridad de la base de datos. Ejecuta `supabase/upgrade-member-accounts.sql` en el SQL Editor como postgres. Es transaccional y repetible; incluye las migraciones anteriores pendientes. No ejecutes `install.sql` sobre una base existente.
2. Despliega el codigo. Configura `SUPABASE_SERVICE_ROLE_KEY` solo en el servidor. El navegador nunca recibe esa clave.
3. En Supabase Auth configura un proveedor SMTP para correos a voluntarios. El correo incorporado de Supabase no sirve como servicio de produccion para usuarios externos; comprueba remitente, dominio y limites del proveedor y de Auth. No se ha configurado SMTP automaticamente.
4. En Auth / URL Configuration pon la direccion HTTPS real de la aplicacion en Site URL, sin barra final. Para probar localmente usa un proyecto de pruebas con Site URL local.
5. En Auth / Email Templates, usa `supabase/email-templates/activation.html` para **Magic Link or OTP** y **Confirm signup**. Usa `recovery.html` para **Reset password**. Las plantillas incluyen `{{ .Token }}`, no un enlace de inicio de sesion automatico. El enlace solo abre el formulario de la aplicacion.
6. Desactiva el alta publica de usuarios. Las cuentas las crea administracion. Ajusta la caducidad de OTP (por ejemplo 15 minutos), limites de envio y politica de contrasenas. La aplicacion acepta codigos numericos de 6 a 10 digitos y exige al menos 12 caracteres de contrasena; Supabase puede exigir mas condiciones.
7. Antes de una carga real, prueba con una cuenta de pruebas: alta, correo, codigo incorrecto, codigo correcto, contrasena, entrada, recuperacion, reuso de codigo y aislamiento de entregas. No se han enviado correos reales durante el desarrollo.

Documentacion oficial: [plantillas y tokens](https://supabase.com/docs/guides/auth/auth-email-templates), [OTP por correo](https://supabase.com/docs/guides/auth/auth-email-passwordless), [SMTP de produccion](https://supabase.com/docs/guides/auth/auth-smtp).

## Identidad y permisos

- `auth.users` es la identidad de acceso. `profiles` conserva los permisos y sede. Cada perfil genera o enlaza exactamente una ficha de `volunteers`, aunque no haya entregas.
- Todos son voluntarios; el rol `volunteer` significa **solo acceso personal**, no una segunda clase de persona. Administrador/editor/lector conservan sus permisos operativos y tambien tienen ficha personal.
- Nombre, sede, estado y correo de acceso se sincronizan. No se permite desvincular ni reasignar arbitrariamente una ficha. Cambiar el correo en Auth actualiza el de la ficha.
- Un administrador puede no tener sede de referencia y mantener acceso global. Necesita una sede de referencia para registrar sus entregas; asignarla no limita sus permisos globales.
- La migracion enlaza fichas antiguas cuando el correo y la sede coinciden sin ambiguedad. Las fichas sin cuenta o correo permanecen en **Fichas antiguas pendientes de alta**. Completa el alta desde su detalle o mediante una carga con correo/codigo coincidente. Nunca se inventan correos ni se eliminan historiales.
- Los voluntarios solo leen su propia ficha, entregas y solicitudes. Los historiales existentes no se descuentan otra vez del stock.

## CSV / Excel de personas

Desde Usuarios o Voluntarios, abre **Importar CSV / Excel**. `public/plantilla-usuarios.csv` contiene un ejemplo ficticio que debes sustituir por datos reales; no importes la fila de ejemplo.

Una fila por persona, con nombre completo y correo obligatorios. El codigo es opcional; si falta, se genera un identificador estable. La sede puede venir por nombre exacto o UUID, o seleccionarse para toda la carga. Se admiten CSV UTF-8 (coma, punto y coma, tabulador) y XLSX de una sola hoja, hasta 500 filas, 40 columnas y 1 MB. Divide archivos mayores. No incluye contrasenas ni asigna permisos desde columnas del archivo; las nuevas cuentas tienen acceso personal.

1. Leer archivo y relacionar columnas. Las columnas no seleccionadas se ignoran.
2. Revisar la vista previa. Se consulta toda la base por los correos, no los primeros usuarios del listado.
3. Confirmar y preparar altas. Se valida toda la carga antes de guardar el lote; aun no se envian correos.
4. Pulsar **Crear cuentas y enviar codigos pendientes**. El proceso avanza fila a fila, se detiene ante errores y puede reanudarse desde la misma direccion o desde las ultimas cargas del administrador.

Los correos se normalizan a minusculas, no se reutilizan nombres como identificador. Correos o codigos duplicados se rechazan. Una cuenta existente conserva su nombre, sede, permisos y contrasena; no se envia codigo de alta si ya tiene contrasena. Para cambiarla se utiliza recuperacion. Si la cuenta existe sin contrasena, se puede reintentar el correo. Para completar historiales antiguos, las sedes deben coincidir.

## Reintentos y limites

La preparacion es transaccional e idempotente por identificador de carga y contenido. La creacion en Auth utiliza una solicitud previamente autorizada en Postgres; un trigger crea el perfil y su ficha en la misma transaccion. No se conceden permisos desde `user_metadata` manipulable por el usuario.

Cada fila tiene una reserva temporal de dos minutos para impedir procesos simultaneos. Auth y SMTP son servicios distintos: el lote no es una unica transaccion y puede quedar parcialmente completado. No se elimina una cuenta cuando falla el correo. Reintenta **la misma carga**, no vuelvas a subirla. Si se perdio la respuesta tras enviar un correo, un reintento puede enviar un codigo nuevo; debe usarse el ultimo recibido. "Solicitado" significa aceptado por Auth, no prueba de entrega en la bandeja. Revisa los registros SMTP si no llega.

Las sesiones creadas al verificar codigos permanecen en memoria del servidor, nunca se devuelven al navegador ni sustituyen la sesion de un administrador. Tras guardar la contrasena se revocan los refresh tokens y el usuario inicia sesion normalmente. Los JWT ya emitidos pueden seguir validos hasta su expiracion; configura su duracion segun la politica de seguridad de la ONG.

Esta carga importa cuentas, no movimientos de material. Las entregas ya existentes permanecen vinculadas y las nuevas se registran desde la ficha. La importacion masiva de entregas requiere definir las columnas del futuro archivo y conciliar cada material/talla con el catalogo antes de afectar existencias.
