# Sistema de Monitoreo de Crecidas de Ríos - IoT

![Estado: En desarrollo](https://img.shields.io/badge/Estado-En%20Desarrollo-yellow)
![Versión](https://img.shields.io/badge/Versión-1.0.0-blue)
![ESP32](https://img.shields.io/badge/ESP32-Compatible-green)

Este proyecto implementa un sistema IoT para el monitoreo y detección temprana de crecidas en ríos, con notificación in situ y a través de un dashboard web. Forma parte del Challenge #2 del curso.

## 📋 Contenido

- [Descripción](#descripción)
- [Estructura del Proyecto](#estructura-del-proyecto)
- [Requisitos](#requisitos)
- [Guía de Instalación](#guía-de-instalación)
  - [Modo Simulador](#modo-simulador-sin-hardware)
  - [Modo Hardware Real](#modo-hardware-real-esp32)
- [Características](#características)
- [Estado del Proyecto](#estado-del-proyecto)
- [Contribuidores](#contribuidores)

## 📝 Descripción

El sistema está diseñado para monitorizar en tiempo real las variables físicas que indican posibles crecidas en ríos. Utiliza sensores para medir la distancia (nivel del agua), temperatura y otros parámetros. Los datos se muestran en un tablero de control web, donde las autoridades pueden visualizar el estado actual y un histórico de las variables, así como recibir notificaciones y desactivar alarmas.

## 📁 Estructura del Proyecto

```
proyecto-monitoreo-crecidas/
│
├── esp32/                          # Código para el ESP32
│   ├── monitoreo_crecidas.ino      # Sketch principal para ESP32
│   └── data/                       # Archivos para SPIFFS
│       ├── index.html              # Página principal
│       ├── historico.html          # Página de histórico
│       └── WebPage/                # Recursos web
│           ├── CSS/
│           └── JS/
│
├── arduino/                        # Código para Arduino (respaldo)
│   └── monitoreo_arduino.ino       # Sketch para Arduino
│
├── simulador/                      # Simulador para pruebas sin hardware
│   ├── server.js                   # Servidor de simulación
│   ├── package.json                # Dependencias Node.js
│   └── public/                     # Archivos públicos
│       ├── index.html              # Dashboard simulado
│       ├── historico.html          # Histórico simulado
│       └── WebPage/                # Recursos web
│           ├── CSS/
│           └── JS/
│
├── docs/                           # Documentación
└── README.md                       # Este archivo
```

## 🔧 Requisitos

### Para el modo hardware real:
- ESP32
- Sensor ultrasónico HC-SR04
- Sensor de temperatura TMP36GZ
- LCD I2C 16x2
- LEDs (verde, amarillo, rojo)
- Buzzer
- Cables y protoboard
- Arduino IDE con soporte para ESP32

### Para el modo simulador:
- Node.js (v14 o superior)
- npm (incluido con Node.js)

## 🚀 Guía de Instalación

### Modo Simulador (sin hardware)

Este modo permite probar el sistema sin necesidad de hardware físico, utilizando datos simulados.

1. **Clonar el repositorio**
   ```bash
   git clone [URL_REPOSITORIO]
   cd proyecto-monitoreo-crecidas/simulador
   ```

2. **Instalar dependencias**
   ```bash
   npm install
   ```

3. **Iniciar el simulador**
   ```bash
   npm start
   ```

4. **Acceder al dashboard**
   - Abre tu navegador y visita:
     - Dashboard: http://localhost:3000
     - Histórico: http://localhost:3000/historico

5. **Controlar la simulación**
   - En la terminal donde ejecutaste el servidor, puedes usar estos comandos:
     - `distance X` - Establece la distancia a X cm
     - `temp X` - Establece la temperatura a X °C
     - `humidity X` - Establece la humedad a X %
     - `scenario [normal|caution|warning|critical]` - Establece un escenario predefinido
     - `help` - Muestra la ayuda
     - `exit` - Detiene el servidor

### Modo Hardware Real (ESP32)

1. **Configurar Arduino IDE para ESP32**
   - Instalar el soporte para placas ESP32 en Arduino IDE
   - Instalar las bibliotecas necesarias:
     * ESP32
     * ESPAsyncWebServer
     * AsyncTCP
     * ArduinoJson
     * WebSocketsServer
     * LiquidCrystal_I2C
     * SPIFFS

2. **Conexiones del hardware**
   - Conectar los componentes según el esquema en `/docs/esquemas/conexiones_esp32.png`
   - **Sensor HC-SR04**: 
     * Trigger -> GPIO 5
     * Echo -> GPIO 4
   - **Sensor de temperatura**: Pin analógico 34
   - **Buzzer**: GPIO 16
   - **LEDs**:
     * Verde (Normal) -> GPIO 17
     * Amarillo (Warning) -> GPIO 18
     * Rojo (Critical) -> GPIO 19
   - **LCD I2C**:
     * SDA -> GPIO 21
     * SCL -> GPIO 22

3. **Cargar archivos al sistema de archivos SPIFFS**
   - Copiar todos los archivos de la carpeta `/esp32/data/` a la carpeta de datos del proyecto Arduino
   - Usar la herramienta ESP32 Sketch Data Upload para subir los archivos

4. **Configurar credenciales WiFi**
   - Editar el archivo `monitoreo_crecidas.ino` y modificar:
     ```cpp
     const char* ssid = "TuRedWiFi";
     const char* password = "TuContraseña";
     ```

5. **Cargar el sketch al ESP32**
   - Compilar y subir el sketch `monitoreo_crecidas.ino` al ESP32

6. **Acceder al dashboard**
   - Conectarse a la misma red WiFi del ESP32
   - Abrir un navegador y acceder a la IP mostrada en el monitor serial del ESP32
   - Normalmente: http://[IP_ESP32]/

## ✨ Características

- **Dashboard en tiempo real** con menú lateral y diseño responsive
- **Medidores visuales** para temperatura y humedad
- **Indicador de nivel** para distancia/nivel del agua
- **Sistema de estados** (NORMAL, CAUTION, WARNING, CRITICAL)
- **Alertas sonoras** mediante buzzer físico
- **Histórico de datos** con filtros y exportación a CSV
- **Estadísticas** sobre las mediciones realizadas
- **Servidor Web incorporado** en el ESP32
- **Comunicación mediante WebSockets** para actualizaciones inmediatas

## 📊 Estado del Proyecto

El proyecto se encuentra en fase de desarrollo activo. Se han implementado las funcionalidades básicas:

- ✅ Lectura de sensores
- ✅ Procesamiento de datos
- ✅ Dashboard web con histórico
- ✅ Sistema de alertas
- ✅ Simulador para pruebas

Próximas mejoras:
- ⬜ Implementación de gráficos de tendencias
- ⬜ Sistema de autenticación
- ⬜ Alertas por correo electrónico/SMS
- ⬜ Conexión con múltiples nodos sensores

## 👥 Contribuidores

- [Nombre Apellido](mailto:email@example.com)
- [Nombre Apellido](mailto:email@example.com)
- [Nombre Apellido](mailto:email@example.com)

---

Desarrollado para la Universidad de La Sabana - Challenge #2 - 2025