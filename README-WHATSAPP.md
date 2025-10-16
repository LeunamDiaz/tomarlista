# 📱 Sistema de Notificaciones WhatsApp - Proyecto Umbral

## ✅ Funcionalidad Implementada

He implementado completamente el sistema de notificaciones por WhatsApp para informar a los padres cuando sus hijos no asistan a clases.

### 🆕 Nuevas Características

1. **Formulario de Estudiantes Mejorado**
   - Campos para nombre del padre/madre/tutor
   - Campo para teléfono del padre/madre/tutor
   - Validación de datos

2. **Botón de Notificación**
   - Disponible solo para administradores
   - Aparece cuando hay datos de contacto del padre/madre
   - Confirmación antes de enviar

3. **Mensaje Automático Formal**
   - Texto profesional y claro
   - Incluye nombre del estudiante y matrícula
   - Fecha de la ausencia
   - Información de contacto de la institución

4. **Múltiples Proveedores de WhatsApp**
   - WhatsApp Business API (Meta) - Recomendado
   - Twilio WhatsApp API
   - API Gateway personalizado

## 🚀 Cómo Usar

### Paso 1: Configurar WhatsApp

Elige una de estas opciones:

#### Opción A: WhatsApp Business API (Meta) - RECOMENDADA
1. Ve a [developers.facebook.com](https://developers.facebook.com)
2. Crea una aplicación y agrega WhatsApp Business API
3. Obtén tus credenciales:
   - Access Token
   - Phone Number ID
   - Business Account ID

#### Opción B: Twilio WhatsApp API
1. Ve a [twilio.com](https://twilio.com)
2. Activa WhatsApp Sandbox
3. Obtén tus credenciales:
   - Account SID
   - Auth Token

#### Opción C: API Gateway (360dialog, etc.)
1. Regístrate en un proveedor como 360dialog
2. Obtén tu API URL y Key

### Paso 2: Configurar Variables de Entorno

Crea un archivo `.env.local` en la raíz del proyecto:

```bash
# Para WhatsApp Business API (Meta)
WHATSAPP_ACCESS_TOKEN=tu_token_aqui
WHATSAPP_PHONE_NUMBER_ID=tu_phone_id_aqui
WHATSAPP_BUSINESS_ACCOUNT_ID=tu_business_id_aqui

# O para Twilio
TWILIO_ACCOUNT_SID=tu_account_sid_aqui
TWILIO_AUTH_TOKEN=tu_auth_token_aqui
TWILIO_WHATSAPP_NUMBER=+14155238886

# O para API Gateway
WHATSAPP_API_GATEWAY_URL=https://waba.360dialog.io/v1/messages
WHATSAPP_API_GATEWAY_KEY=tu_api_key_aqui
```

### Paso 3: Instalar Dependencias

```bash
npm install
```

### Paso 4: Reiniciar el Servidor

```bash
npm run dev
```

### Paso 5: Usar la Funcionalidad

1. **Agregar Estudiante con Datos de Padre/Madre:**
   - Ve al panel de administración
   - Haz clic en "+ Alumno"
   - Completa los campos del padre/madre/tutor

2. **Notificar Ausencia:**
   - Ve al panel de administración
   - Busca el estudiante ausente
   - Haz clic en el estudiante para ver detalles
   - Haz clic en "📱 Notificar Ausencia"
   - Confirma el envío

## 💰 Costos Estimados

| Proveedor | Costo por Mensaje | Costo Mensual (100 msgs) | Costo Mensual (1000 msgs) |
|-----------|-------------------|---------------------------|----------------------------|
| WhatsApp Business API | $0.005 USD | ~$0.50 USD | ~$5 USD |
| Twilio WhatsApp | $0.005 USD | ~$0.50 USD | ~$5 USD |
| API Gateway | Variable | $1-3 USD | $5-15 USD |

## 📋 Ejemplo de Mensaje

```
Estimado/a [Nombre del Padre/Madre],

Le informamos que su hijo/a [Nombre del Estudiante] (Matrícula: [Matrícula]) no se presentó a clases el día [Fecha].

Por favor, confirme si conoce el motivo de la ausencia o si necesita más información.

Atentamente,
Proyecto Umbral - Sistema de Asistencia

Este es un mensaje automático.
```

## 🔧 Archivos Modificados

- `src/app/page.js` - Interfaz principal con nuevos campos y botón
- `src/app/api/send-whatsapp/route.js` - API para envío de mensajes
- `package.json` - Dependencia de Twilio agregada
- `docs/whatsapp-setup.md` - Documentación detallada
- `whatsapp-config.example.txt` - Ejemplo de configuración

## 🛠️ Solución de Problemas

### Error: "WhatsApp no configurado"
- Verifica que las variables de entorno estén configuradas
- Reinicia el servidor

### Error: "Número de teléfono inválido"
- Asegúrate de incluir el código de país (+52 para México)
- El número debe tener al menos 10 dígitos

### Error: "Error de permisos"
- Verifica que tu token tenga los permisos correctos
- Para WhatsApp Business API, asegúrate de que la app esté verificada

## 📞 Soporte

Si tienes problemas:
1. Revisa los logs del servidor
2. Consulta `docs/whatsapp-setup.md`
3. Verifica la documentación oficial del proveedor elegido

## 🎯 Próximos Pasos Recomendados

1. **Configurar WhatsApp Business API** (más confiable)
2. **Probar con un número real** antes de usar en producción
3. **Configurar webhooks** para recibir confirmaciones de entrega
4. **Implementar logs** para rastrear mensajes enviados
5. **Agregar plantillas personalizables** para diferentes tipos de mensajes

¡La funcionalidad está lista para usar! 🎉





