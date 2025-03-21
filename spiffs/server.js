const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

// Crear aplicación Express
const app = express();
const server = http.createServer(app);

// Configurar servidor WebSocket
const wss = new WebSocket.Server({ server });

// Servir archivos estáticos desde la carpeta 'public'
app.use(express.static(path.join(__dirname, 'public')));

// Variables de simulación iniciales
let simulationData = {
  distance: 35, // cm
  temperature: 22, // °C
  humidity: 60, // %
  status: "NORMAL"
};

// Historial de datos
const MAX_HISTORY_ENTRIES = 100;
const historyData = [];

// Función para actualizar el estado según la distancia
function updateStatus(dist) {
  if (dist > 30) {
    return "NORMAL";
  } else if (dist <= 30 && dist > 20) {
    return "CAUTION";
  } else if (dist <= 20 && dist > 10) {
    return "WARNING";
  } else {
    return "CRITICAL";
  }
}

// Función para generar datos simulados con variaciones aleatorias
function generateRandomData() {
  // Añadir pequeña variación aleatoria a la distancia (-2 a +2 cm)
  simulationData.distance += (Math.random() * 4 - 2);
  
  // Mantener la distancia entre 5 y 40 cm
  simulationData.distance = Math.max(5, Math.min(40, simulationData.distance));
  
  // Pequeña variación en temperatura (-0.5 a +0.5 °C)
  simulationData.temperature += (Math.random() - 0.5);
  simulationData.temperature = Math.round(simulationData.temperature * 10) / 10;
  
  // Pequeña variación en humedad
  simulationData.humidity += (Math.random() * 2 - 1);
  simulationData.humidity = Math.max(20, Math.min(95, simulationData.humidity));
  simulationData.humidity = Math.round(simulationData.humidity * 10) / 10;
  
  // Actualizar estado
  simulationData.status = updateStatus(simulationData.distance);
  
  // Agregar la entrada al historial
  const historyEntry = {
    timestamp: Date.now(),
    distance: simulationData.distance,
    temperature: simulationData.temperature,
    humidity: simulationData.humidity,
    status: simulationData.status
  };
  
  historyData.unshift(historyEntry);
  
  // Limitar el tamaño del historial
  if (historyData.length > MAX_HISTORY_ENTRIES) {
    historyData.pop();
  }
  
  return { ...simulationData };
}

// Manejar conexiones WebSocket
wss.on('connection', (ws) => {
  console.log('Cliente conectado');
  
  // Enviar datos simulados cada segundo
  const interval = setInterval(() => {
    const data = generateRandomData();
    ws.send(JSON.stringify(data));
  }, 1000);
  
  // Limpiar el intervalo cuando el cliente se desconecta
  ws.on('close', () => {
    console.log('Cliente desconectado');
    clearInterval(interval);
  });
});

// Rutas API
app.get('/api/current', (req, res) => {
  res.json(simulationData);
});

app.get('/api/history', (req, res) => {
  // Parámetros de filtrado opcional
  const count = req.query.count ? parseInt(req.query.count) : MAX_HISTORY_ENTRIES;
  const fromTime = req.query.from ? parseInt(req.query.from) : 0;
  const estado = req.query.estado || 'all';
  
  // Filtrar datos
  let filteredHistory = historyData;
  
  if (fromTime > 0) {
    filteredHistory = filteredHistory.filter(item => item.timestamp >= fromTime);
  }
  
  if (estado !== 'all') {
    filteredHistory = filteredHistory.filter(item => item.status === estado);
  }
  
  // Limitar cantidad
  filteredHistory = filteredHistory.slice(0, count);
  
  res.json(filteredHistory);
});

// Ruta para apagar dispositivos (simulación)
app.post('/apagar', (req, res) => {
  console.log('Comando recibido: Apagar dispositivos');
  res.send('Alarmas apagadas');
});

// Manejar ruta de histórico
app.get('/historico', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'historico.html'));
});

// Interfaz de control de la simulación (solo accesible desde consola del servidor)
const readline = require('readline');
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

console.log('Comandos de simulación disponibles:');
console.log('  distance X - Establece la distancia a X cm');
console.log('  temp X - Establece la temperatura a X °C');
console.log('  humidity X - Establece la humedad a X %');
console.log('  help - Muestra esta ayuda');
console.log('  exit - Detiene el servidor');

rl.on('line', (input) => {
  const parts = input.trim().split(' ');
  const command = parts[0].toLowerCase();
  const value = parseFloat(parts[1]);
  
  switch(command) {
    case 'distance':
      if (!isNaN(value)) {
        simulationData.distance = value;
        simulationData.status = updateStatus(value);
        console.log(`Distancia establecida a ${value} cm (Estado: ${simulationData.status})`);
      }
      break;
    case 'temp':
      if (!isNaN(value)) {
        simulationData.temperature = value;
        console.log(`Temperatura establecida a ${value} °C`);
      }
      break;
    case 'humidity':
      if (!isNaN(value)) {
        simulationData.humidity = value;
        console.log(`Humedad establecida a ${value}%`);
      }
      break;
    case 'help':
      console.log('Comandos de simulación disponibles:');
      console.log('  distance X - Establece la distancia a X cm');
      console.log('  temp X - Establece la temperatura a X °C');
      console.log('  humidity X - Establece la humedad a X %');
      console.log('  help - Muestra esta ayuda');
      console.log('  exit - Detiene el servidor');
      break;
    case 'exit':
      console.log('Deteniendo servidor...');
      process.exit(0);
      break;
    default:
      console.log('Comando no reconocido. Escribe "help" para ver los comandos disponibles.');
  }
});

// Iniciar el servidor en el puerto 3000
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor iniciado en http://localhost:${PORT}`);
  console.log(`WebSocket disponible en ws://localhost:${PORT}`);
  
  // Generar algunos datos históricos iniciales
  for (let i = 0; i < 20; i++) {
    generateRandomData();
  }
});