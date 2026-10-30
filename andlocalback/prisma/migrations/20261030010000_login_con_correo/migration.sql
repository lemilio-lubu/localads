-- El correo pasa a ser el usuario de acceso de los clientes. Hasta ahora el
-- usuario se derivaba de la parte anterior a la arroba (emilio.jacome@x.com ->
-- emiliojacome); desde aqui el cliente entra con su correo completo.
--
-- Solo se tocan los usuarios CLIENT. Admin y gestores no tienen correo y siguen
-- entrando con su usuario. No se borra ni se cambia ninguna clave ni sesion.
-- El NOT EXISTS evita que un choque de UNIQUE tumbe el despliegue: el usuario
-- en conflicto conserva su usuario anterior y queda a la vista con la consulta
-- de comprobacion del PR. El correo del cliente ya es unico y los usuarios del
-- equipo no admiten "@", asi que en la practica no debe haber conflictos.
UPDATE "AuthUser" AS u
SET "username" = lower(btrim(c."email"))
FROM "Client" AS c
WHERE u."clientId" = c."id"
  AND u."role" = 'CLIENT'
  AND u."username" <> lower(btrim(c."email"))
  AND NOT EXISTS (
    SELECT 1 FROM "AuthUser" AS other
    WHERE other."username" = lower(btrim(c."email")) AND other."id" <> u."id"
  );
