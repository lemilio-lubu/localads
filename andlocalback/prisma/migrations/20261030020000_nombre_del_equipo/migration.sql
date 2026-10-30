-- Nombre de la persona del equipo. El usuario es su correo y solo sirve para
-- entrar; en pantalla se ve el nombre. Nulo en las cuentas existentes: no hay
-- de donde sacarlo, y la pantalla cae al usuario hasta que alguien lo escriba.
ALTER TABLE "AuthUser" ADD COLUMN "name" TEXT;
