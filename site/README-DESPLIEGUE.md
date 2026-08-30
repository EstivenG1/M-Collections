# M Collections — Guía para publicar la página

Esta guía te lleva paso a paso para dejar la página funcionando en internet,
con un link que puedes compartir y que con el tiempo aparecerá en Google.
No necesitas saber programar — solo ir siguiendo los pasos. Toma unos 20-30
minutos la primera vez.

Vas a usar dos servicios **gratuitos y sin pedir tarjeta de crédito**:

- **Firebase** (de Google): guarda los productos, las secciones y las fotos.
- **Netlify**: publica la página en internet con un link público.

> **Nota:** Google cambió su política en 2026 y ahora **Firebase Storage**
> (el servicio típico para guardar fotos) pide una tarjeta vinculada, aunque
> no cobre nada dentro del uso gratuito. Para que tu mamá no tenga que meter
> ninguna tarjeta, esta página **no usa Storage** — las fotos se guardan
> comprimidas directamente en la base de datos (Firestore), que sigue
> siendo 100% gratis sin tarjeta. Por eso las fotos se comprimen un poco
> más fuerte al subirlas; para catálogo web se ven perfectas igual.

---

## PARTE 1 — Crear la base de datos (Firebase)

1. Entra a **https://console.firebase.google.com** e inicia sesión con una
   cuenta de Google (puede ser la de tu mamá o la tuya, la que vaya a
   administrar esto).
2. Clic en **"Crear un proyecto"**. Ponle de nombre, por ejemplo,
   `m-collections`. Puedes desactivar Google Analytics (no lo necesitas).
3. Cuando el proyecto esté listo, en el menú de la izquierda entra a
   **Compilación (Build) → Firestore Database** → **Crear base de datos**.
   Elige la ubicación más cercana (por ejemplo `southamerica-east1`) y
   selecciona **modo producción**.
4. Ve a **Compilación → Authentication** → **Comenzar** → en la pestaña
   **Sign-in method**, habilita **Correo electrónico/contraseña**.
   Luego ve a la pestaña **Users** → **Add user** y crea el usuario de tu
   mamá: su correo y una contraseña segura. **Ese correo y contraseña son
   con los que ella va a entrar al panel de administrador de la página.**

   No necesitas activar **Storage** — este proyecto no lo usa.

### 5. Reglas de seguridad

En **Firestore Database → Reglas (Rules)**, reemplaza el contenido por esto
y publica:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /sections/{doc} {
      allow read: if true;
      allow write: if request.auth != null;
    }
    match /products/{doc} {
      allow read: if true;
      allow write: if request.auth != null;
    }
  }
}
```

Esto significa: **cualquiera puede ver** los productos (para eso es la
página), pero **solo alguien que inició sesión** (tu mamá) puede
crear, editar o borrar algo.

### 6. Copiar la configuración a la página

1. En Firebase, ve al ícono de engranaje (⚙️) arriba a la izquierda →
   **Configuración del proyecto**.
2. Baja hasta **"Tus apps"** → clic en el ícono `</>` (Web) → ponle un
   nombre, ej. `m-collections-web` → **Registrar app**.
3. Firebase te va a mostrar un bloque de código con `firebaseConfig = {...}`.
   Copia esos valores.
4. Abre el archivo `assets/firebase-config.js` de esta carpeta y reemplaza
   cada `PEGA_AQUI_TU_...` con el valor correspondiente. Guarda el archivo.

---

## PARTE 2 — Publicar la página (Netlify)

1. Entra a **https://app.netlify.com/drop**
2. Arrastra **toda esta carpeta** (`m-collections-site`, la que contiene
   `index.html`) directamente sobre esa página.
3. En segundos te va a dar un link público, algo como
   `https://random-name-123.netlify.app`. ¡Esa ya es tu página funcionando!
4. Para tener un link más bonito: crea una cuenta gratis en Netlify
   (te la pide para guardar el sitio permanentemente), entra al sitio que
   subiste → **Site configuration → Change site name** → escribe algo como
   `mcollections` → tu link queda `https://mcollections.netlify.app`.
5. **Opcional:** si más adelante quieres un dominio propio como
   `mcollections.com`, lo compras en cualquier proveedor (Namecheap,
   GoDaddy, etc. — unos $12-15 USD al año) y lo conectas desde
   **Site configuration → Domain management** en Netlify. Yo te puedo
   ayudar con esa parte cuando la tengas.

### Actualizar el sitio en el futuro

Cada vez que quieras cambiar el código de la página (no los productos —
esos los sube tu mamá desde el panel), vuelve a
**https://app.netlify.com/drop** y arrastra la carpeta actualizada.

---

## PARTE 3 — Que aparezca al buscar "M Collections" en Google

1. Con tu link ya público, edita los archivos `robots.txt` y `sitemap.xml`
   de esta carpeta: cambia `TU-DOMINIO-AQUI` por tu link real (ej.
   `mcollections.netlify.app`), y vuelve a subir la carpeta a Netlify.
2. Entra a **https://search.google.com/search-console**, agrega tu link
   como propiedad y verifica que eres el dueño (Netlify te da la opción de
   verificarlo fácilmente con un archivo o una etiqueta HTML).
3. Dentro de Search Console, en **Sitemaps**, envía la URL
   `sitemap.xml`.
4. Google normalmente indexa (muestra en resultados) un sitio nuevo en
   **unos días a un par de semanas**. Mientras tanto, el link funciona
   perfecto para compartirlo directo por WhatsApp, Instagram o donde
   quieras — la gente no necesita buscarlo en Google para entrar.

---

## Primeros pasos dentro de la página ya publicada

1. Abre tu link → clic en el ícono de candado (arriba a la derecha) →
   entra con el correo y la contraseña que creaste en el paso 4 de la
   Parte 1.
2. Ve a la pestaña **Secciones** y crea las que necesites (Maquillaje,
   Lociones, Velas aromáticas, Cobijas y mantas, Cortinas, Revistas, etc.).
3. Ve a **Productos → Agregar producto** y empieza a subir el catálogo.
   Marca la casilla **"Mostrar en Destacados"** en los productos que
   quieras resaltar arriba de todo.

Cualquier duda con algún paso, dime exactamente en cuál te quedaste y te
ayudo a resolverlo.
