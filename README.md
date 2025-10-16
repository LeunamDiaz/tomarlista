# Sistema de Asistencia - Proyecto Umbral

Sistema de registro de asistencia estudiantil con interfaz minimalista y administración segura.

## Características

- **Registro de asistencia**: Los estudiantes pueden registrar su asistencia diaria con matrícula
- **Validación diaria**: Solo permite un registro por día por estudiante
- **Panel administrativo**: Acceso protegido por contraseña para ver la lista de estudiantes
- **Indicadores visuales**: Bordes verdes para estudiantes presentes, rojos para ausentes
- **Registro de fecha y hora**: Cada asistencia se registra con fecha y hora específica

## Instalación

```bash
npm install
```

## Desarrollo

Para ejecutar el servidor de desarrollo:

```bash
npm run dev
```

Abre [http://localhost:3000](http://localhost:3000) en tu navegador para ver la aplicación.

## Uso

1. **Registro de asistencia**: Los estudiantes ingresan su matrícula en el formulario principal
2. **Acceso administrativo**: Los administradores pueden acceder con contraseña para ver la lista completa de estudiantes
3. **Visualización de estado**: Los estudiantes presentes aparecen con borde verde, los ausentes con borde rojo

## Construcción

```bash
npm run build
```

## Tecnologías

- React 19
- Tailwind CSS
- Framer Motion
- JavaScript ES6+

## Estructura del Proyecto

```
src/
  app/
    page.js          # Página principal con sistema de asistencia
    globals.css      # Estilos globales
    layout.js        # Layout de la aplicación
```

## Funcionalidades

- ✅ Registro de asistencia diaria
- ✅ Validación de duplicados
- ✅ Panel administrativo protegido
- ✅ Indicadores visuales de presencia
- ✅ Mensajes de bienvenida personalizados
- ✅ Interfaz responsiva y minimalista