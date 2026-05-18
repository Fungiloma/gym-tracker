# 🏋️ Gym Tracker PWA

Tu plan de entrenamiento personalizado, instalable como app nativa en iOS y Android.

**[Ir a la app](https://fungiloma.github.io/gym-tracker/)**

---

## ✨ Características

- ✅ **Instalable en iOS y Android** como app nativa
- ✅ **Funciona sin conexión** — todo se guarda localmente
- ✅ **Seguimiento de pesos** — carga última sesión automáticamente
- ✅ **Timers integrados** — descanso entre series con notificación
- ✅ **Historial expandible** — ve todos tus entrenamientos pasados
- ✅ **Resumen copiable** — copia sesión al chat para análisis

---

## 📱 Instalación

### Android (Chrome)

1. Abre la app en Chrome: **[gym-tracker](https://fungiloma.github.io/gym-tracker/)**
2. Chrome mostrará un banner **"Instalar app"** automáticamente
3. Tap en "Instalar" → se añade al launcher del Pixel
4. Listo — abre desde el icono como cualquier app nativa

### iOS (Safari)

1. Abre la app en Safari: **[gym-tracker](https://fungiloma.github.io/gym-tracker/)**
2. Tap en el botón de compartir (↗️ abajo a la derecha)
3. Selecciona **"Añadir a pantalla de inicio"**
4. Confirma — se crea un icono en home
5. Abre desde el icono — funciona en modo fullscreen

---

## 🎯 Cómo usar

### Iniciar una sesión

1. En la pantalla principal, selecciona una sesión (Pecho + Hombro, Pierna, etc.)
2. Aparecerán todos los ejercicios del plan
3. Rellena los pesos (kg) en los inputs
4. Los pesos de la última sesión del mismo tipo se cargarán automáticamente

### Timers

- Cada serie con descanso mostrará un botón **⏱**
- Tap para iniciar el timer → sonará cuando acabe
- Puedes pausar/reanudar o cerrar el timer manualmente

### Guardar sesión

1. Al terminar, tap en **"✅ Guardar sesión y ver feedback"**
2. Ves el resumen de toda la sesión
3. Tap en **"📋 Copiar para pegar en el chat"**
4. Pega el resumen en el chat de tu entrenador (o guardar en notas)

### Ver historial

- Desde cualquier pantalla, tap en **"📊 Ver historial"**
- Lista de todas las sesiones guardadas (más recientes primero)
- Tap en una sesión para expandir/contraer detalles
- El estado se mantiene — si cierras la app, la expansión se recuerda

---

## 📊 Datos locales

**Ubicación:** Los datos se guardan en `localStorage` del navegador

- `gym-sessions` — Array con todas las sesiones completadas
- `gym-state` — Estado actual (sesión activa, expansiones, etc.)

**Copia de seguridad:** Abre DevTools (F12) → Application → Storage → copiar los valores JSON

---

## 🔄 Offline-first

La app es completamente offline. Los datos **nunca salen del teléfono** a menos que tú los copies al chat.

Si pierdes conexión:
- ✅ Puedes entrenar normalmente
- ✅ Timers funcionan
- ✅ Los datos se guardan localmente
- ❌ No hay sincronización con otros dispositivos (es intencional)

---

## 🛠️ Desarrollo local

```bash
# Clonar el repo
git clone https://github.com/Fungiloma/gym-tracker.git
cd gym-tracker

# Servir en http://localhost:8000
python -m http.server 8000

# En el navegador
# http://localhost:8000
```

**Con HTTPS (necesario para PWA en teléfono real):**

```bash
# Opción 1: Ngrok (temporal)
npx ngrok http 8000
# → https://xxxx-xx-xxx-xxx-xx.ngrok.io

# Opción 2: GitHub Pages (recomendado)
git push → automáticamente en https://fungiloma.github.io/gym-tracker/
```

---

## 🚀 Despliegue

Simplemente haz push a GitHub:

```bash
git add .
git commit -m "Update"
git push
```

GitHub Pages automáticamente:
1. Detecta los cambios
2. Publica en `https://fungiloma.github.io/gym-tracker/`
3. El Service Worker se actualiza en la app instalada

---

## 📝 Notas

- **Datos persistentes:** Si desinstala la app, los datos locales se borran
- **Múltiples dispositivos:** Los datos no se sincronizan entre teléfonos (cada app es independiente)
- **Respaldo:** Antes de actualizar el teléfono, copia el JSON del historial desde DevTools

---

## 🔧 Tech Stack

- **Frontend:** HTML5 + CSS3 + JavaScript vanilla (ES6)
- **Storage:** localStorage (JSON stringified)
- **PWA:** Service Worker (cache-first) + Web Manifest
- **Offline:** Totalmente funcional sin internet

---

## 📬 Feedback

¿Ideas para mejorar? Crea un issue o contacta directo.

**Entrenador:** Usa el resumen copiado para:
- Guardar progreso
- Análisis semanal/mensual
- Ajustar cargas progresivas

---

**Versión:** 1.0.0  
**Última actualización:** Mayo 2026  
**License:** MIT
