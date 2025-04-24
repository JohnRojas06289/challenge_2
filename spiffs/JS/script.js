document.addEventListener("DOMContentLoaded", function() {
    // Inicializar el toggle del sidebar
    const sidebarToggle = document.getElementById('sidebar-toggle');
    const body = document.body;
    
    sidebarToggle.addEventListener('click', function() {
        if (window.innerWidth > 992) {
            body.classList.toggle('sidebar-collapsed');
        } else {
            body.classList.toggle('sidebar-expanded');
        }
    });
    
    // Inicializar el medidor de temperatura
    const gauge = new JustGage({
        id: "gauge",
        value: 0,
        min: -10,
        max: 50,
        title: "°C",
        label: "Temperatura",
        pointer: true,
        pointerOptions: {
            toplength: -15,
            bottomlength: 10,
            bottomwidth: 12,
            color: '#8e8e93'
        },
        gaugeWidthScale: 0.7,
        counter: true,
        relativeGaugeSize: true
    });

    // Inicializar el medidor de humedad
    const gHumidity = new JustGage({
        id: "gauge-humidity",
        value: 60,  // Valor inicial
        min: 0,
        max: 100,
        title: "%",
        label: "Humedad",
        pointer: true,
        pointerOptions: {
            toplength: -15,
            bottomlength: 10,
            bottomwidth: 12,
            color: '#8e8e93'
        },
        gaugeWidthScale: 0.7,
        counter: true,
        relativeGaugeSize: true
    });
    
    // Historial para datos recientes
    let historialDatos = [];
    const maxHistorialRows = 5; // Máximo de filas en el dashboard
    
    // Función para conectar el WebSocket
    function conectarWebSocket() {
        // Determinar la URL del WebSocket
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/ws`;
        
        console.log(`Conectando a WebSocket: ${wsUrl}`);
        const socket = new WebSocket(wsUrl);
        
        // Evento de conexión establecida
        socket.onopen = function() {
            console.log('Conexión WebSocket establecida');
            mostrarNotificacion('Conexión establecida', 'success');
        };
        
        // Evento de mensaje recibido
        socket.onmessage = function(event) {
            try {
                const data = JSON.parse(event.data);
                console.log('Datos recibidos del sensor:', data);
                
                // Actualizar los elementos visuales con los datos recibidos
                document.getElementById("distance").innerText = data.distance.toFixed(1) + " cm";
                gauge.refresh(data.temperature);
                gHumidity.refresh(data.humidity);
                
                // Actualizar el estado según la distancia
                actualizarEstado(data.status);
                
                // Actualizar el indicador de nivel
                actualizarNivelIndicador(data.distance);
                
                // Actualizar el historial y guardar datos
                actualizarHistorial(data);
                
                // Guardar datos en el servidor
                guardarRegistro(data);
            } catch (e) {
                console.error('Error al procesar mensaje WebSocket:', e);
            }
        };
        
        // Evento de error
        socket.onerror = function(error) {
            console.error('Error en la conexión WebSocket:', error);
            mostrarNotificacion('Error de conexión', 'error');
            
            // Si hay error de WebSocket, intentar con polling
            console.log('Fallback a método de polling...');
            iniciarPolling();
        };
        
        // Evento de conexión cerrada
        socket.onclose = function() {
            console.log('Conexión WebSocket cerrada. Intentando reconectar en 3 segundos...');
            mostrarNotificacion('Conexión perdida. Reconectando...', 'warning');
            
            // Mientras intenta reconectar, usar polling como respaldo
            iniciarPolling();
            
            // Intentar reconectar WebSocket después de un tiempo
            setTimeout(conectarWebSocket, 3000);
        };
        
        return socket;
    }
    
    // Función para iniciar polling como fallback
    let pollingInterval = null;
    function iniciarPolling() {
        // Evitar iniciar múltiples intervalos
        if (pollingInterval) {
            clearInterval(pollingInterval);
        }
        
        // Obtener datos inmediatamente
        obtenerDatosActuales();
        
        // Configurar intervalo para polling
        pollingInterval = setInterval(obtenerDatosActuales, 1000);
    }
    
    // Función para detener polling
    function detenerPolling() {
        if (pollingInterval) {
            clearInterval(pollingInterval);
            pollingInterval = null;
        }
    }
    
// Función para actualizar el estado visual según el estado recibido
function actualizarEstado(estado) {
    const statusDiv = document.getElementById("status");
    statusDiv.innerText = estado;
    statusDiv.className = "status " + estado.toLowerCase();
    
    // Verificar cambio de estado para notificaciones
    if (estado !== appState.lastStatus) {
        appState.lastStatus = estado;
        
        // Mostrar notificación apropiada según el estado
        if (estado === "CRITICAL") {
            appState.alarmActive = true;
            mostrarNotificacion('¡ALERTA CRÍTICA! Nivel de agua peligroso', 'critical', 'fas fa-exclamation-triangle');
            // Mostrar el botón de apagar alarmas
            document.getElementById("alarm-btn").style.display = "flex";
        } else if (estado === "WARNING") {
            mostrarNotificacion('Advertencia: Nivel de agua elevado', 'warning', 'fas fa-exclamation-circle');
        } else if (estado === "CAUTION") {
            mostrarNotificacion('Precaución: Nivel de agua en aumento', 'warning', 'fas fa-info-circle');
        } else if (estado === "NORMAL" && appState.alarmActive) {
            appState.alarmActive = false;
            mostrarNotificacion('Nivel de agua normalizado', 'success', 'fas fa-check-circle');
            // Ocultar el botón si ya no estamos en estado crítico
            document.getElementById("alarm-btn").style.display = "none";
        }
    }
}
    
    // Función para actualizar el indicador visual de nivel
    function actualizarNivelIndicador(distancia) {
        const levelFill = document.getElementById("level-fill");
        // Calcular altura del relleno (invertido: menor distancia = mayor relleno)
        let heightPercentage = 0;
        
        if (distancia <= 10) {
            // Por debajo de 10cm, lleno al 100%
            heightPercentage = 100;
        } else if (distancia >= 40) {
            // Por encima de 40cm, vacío
            heightPercentage = 0;
        } else {
            // Entre 10 y 40cm, escalado
            heightPercentage = 100 - ((distancia - 10) / 30 * 100);
        }
        
        levelFill.style.height = heightPercentage + '%';
    }
    
// Función para apagar dispositivos
window.apagarDispositivos = function() {
    // Mostrar indicador de carga en el botón
    const alarmBtn = document.getElementById("alarm-btn");
    const originalContent = alarmBtn.innerHTML;
    alarmBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Apagando...';
    alarmBtn.disabled = true;
    
    fetch('/apagar', { method: 'POST' })
        .then(response => response.text())
        .then(data => {
            // Restaurar botón después de recibir respuesta
            alarmBtn.innerHTML = originalContent;
            alarmBtn.disabled = false;
            
            // Marcar alarma como desactivada
            appState.alarmActive = false;
            
            // Mostrar confirmación
            mostrarNotificacion(data, 'success', 'fas fa-check-circle');
            console.log('Respuesta del servidor:', data);
            
            // Ocultar el botón si ya no estamos en estado crítico
            if (appState.lastStatus !== "CRITICAL") {
                alarmBtn.style.display = "none";
            }
        })
        .catch(error => {
            // Restaurar botón en caso de error
            alarmBtn.innerHTML = originalContent;
            alarmBtn.disabled = false;
            
            console.error('Error al enviar comando:', error);
            mostrarNotificacion('Error al apagar alarmas', 'error', 'fas fa-times-circle');
        });
};
    
    // Función para guardar registros en el servidor
    function guardarRegistro(data) {
        // Añadir timestamp al objeto de datos
        const registroData = {
            ...data,
            timestamp: data.timestamp || Date.now()
        };
        const localBackupData = localStorage.getItem('sensorDataBackup') || '[]';
        try {
            const backupArray = JSON.parse(localBackupData);
            
            // Comprobar si este registro ya existe (para evitar duplicados)
            const duplicado = backupArray.find(item => 
                item.timestamp === registroData.timestamp
            );
            
            if (!duplicado) {
                backupArray.push(registroData);
                
                // Mantener un tamaño razonable en localStorage (últimos 100 registros)
                if (backupArray.length > 100) {
                    backupArray.shift(); // Eliminar el más antiguo
                }
                
                localStorage.setItem('sensorDataBackup', JSON.stringify(backupArray));
                console.log('Registro guardado en localStorage:', registroData);
            }
        } catch (e) {
            console.error('Error al guardar en respaldo local:', e);
        }
    }
    
    // Función para actualizar el historial de reportes
    function actualizarHistorial(data) {
        // Agregar al inicio del array para mostrar lo más reciente primero
        const fecha = new Date().toLocaleString();
        
        historialDatos.unshift({
            fecha: fecha,
            distancia: data.distance.toFixed(1),
            temperatura: data.temperature.toFixed(1),
            humedad: data.humidity.toFixed(1),
            estado: data.status
        });
        
        // Limitar el tamaño del historial
        if (historialDatos.length > maxHistorialRows) {
            historialDatos = historialDatos.slice(0, maxHistorialRows);
        }
        
        // Actualizar la tabla en el DOM
        const tabla = document.getElementById("historial").getElementsByTagName('tbody')[0];
        if (!tabla) {
            console.error('No se encontró la tabla de historial');
            return;
        }
        
        tabla.innerHTML = ''; // Limpiar tabla
        
        historialDatos.forEach(item => {
            const row = tabla.insertRow();
            row.className = item.estado.toLowerCase();
            
            const cellFecha = row.insertCell(0);
            const cellDistancia = row.insertCell(1);
            const cellTemperatura = row.insertCell(2);
            const cellEstado = row.insertCell(3);
            
            cellFecha.innerHTML = item.fecha;
            cellDistancia.innerHTML = `${item.distancia} cm`;
            cellTemperatura.innerHTML = `${item.temperatura} °C`;
            cellEstado.innerHTML = item.estado;
        });
        
        // Guardar en localStorage para persistencia
        localStorage.setItem('recientHistorial', JSON.stringify(historialDatos));
    }
    
// Estado global para control de notificaciones
const appState = {
    lastStatus: null,
    alarmActive: false,
    lastNotificationTime: 0,
    notificationCooldown: 5000 // 5 segundos entre notificaciones del mismo tipo
};

// Función para mostrar notificaciones
function mostrarNotificacion(mensaje, tipo, icono) {
    // Evitar exceso de notificaciones del mismo tipo
    const ahora = Date.now();
    if (ahora - appState.lastNotificationTime < appState.notificationCooldown) {
        // Solo controlar exceso para notificaciones no críticas
        if (tipo !== 'critical') {
            console.log(`Notificación suprimida (cooldown): ${mensaje}`);
            return;
        }
    }
    appState.lastNotificationTime = ahora;
    
    // Registrar en consola
    console.log(`Notificación (${tipo}): ${mensaje}`);
    
    // Eliminar notificaciones anteriores
    const notificacionesExistentes = document.querySelectorAll('.notification');
    notificacionesExistentes.forEach(notif => {
        notif.classList.remove('show');
        setTimeout(() => {
            if (notif.parentNode) {
                notif.parentNode.removeChild(notif);
            }
        }, 300);
    });
    
    // Crear nueva notificación
    const notif = document.createElement('div');
    notif.className = `notification ${tipo}`;
    
    // Añadir icono si se proporciona
    if (icono) {
        const iconElem = document.createElement('i');
        iconElem.className = icono;
        notif.appendChild(iconElem);
    }
    
    // Añadir mensaje
    const msgElem = document.createElement('span');
    msgElem.textContent = mensaje;
    notif.appendChild(msgElem);
    
    // Añadir al DOM
    document.body.appendChild(notif);
    
    // Mostrar con animación
    setTimeout(() => {
        notif.classList.add('show');
        
        // Tiempo extendido para notificaciones críticas
        const displayTime = tipo === 'critical' ? 10000 : 5000;
        
        setTimeout(() => {
            notif.classList.remove('show');
            setTimeout(() => {
                if (notif.parentNode) {
                    notif.parentNode.removeChild(notif);
                }
            }, 300);
        }, displayTime);
    }, 10);
}
    
    // Cargar historial desde localStorage si existe
    function cargarHistorialGuardado() {
        const historialGuardado = localStorage.getItem('recientHistorial');
        if (historialGuardado) {
            try {
                historialDatos = JSON.parse(historialGuardado);
                // Actualizar la tabla con los datos guardados
                const tabla = document.getElementById("historial").getElementsByTagName('tbody')[0];
                if (!tabla) {
                    console.error('No se encontró la tabla de historial');
                    return;
                }
                
                tabla.innerHTML = ''; // Limpiar tabla
                
                historialDatos.forEach(item => {
                    const row = tabla.insertRow();
                    row.className = item.estado.toLowerCase();
                    
                    const cellFecha = row.insertCell(0);
                    const cellDistancia = row.insertCell(1);
                    const cellTemperatura = row.insertCell(2);
                    const cellEstado = row.insertCell(3);
                    
                    cellFecha.innerHTML = item.fecha;
                    cellDistancia.innerHTML = `${item.distancia} cm`;
                    cellTemperatura.innerHTML = `${item.temperatura} °C`;
                    cellEstado.innerHTML = item.estado;
                });
            } catch (e) {
                console.error('Error al cargar historial:', e);
                // Si hay error, iniciar con array vacío
                historialDatos = [];
            }
        }
    }
    
    // Función para obtener los datos actuales
    function obtenerDatosActuales() {
        fetch('/api/current')
            .then(response => {
                if (!response.ok) {
                    throw new Error('Error obteniendo datos del sensor');
                }
                return response.json();
            })
            .then(data => {
                console.log('Datos recibidos por polling:', data);
                
                // Actualizar los elementos visuales con los datos recibidos
                document.getElementById("distance").innerText = data.distance.toFixed(1) + " cm";
                gauge.refresh(data.temperature);
                gHumidity.refresh(data.humidity);
                
                // Actualizar el estado según la distancia
                actualizarEstado(data.status);
                
                // Actualizar el indicador de nivel
                actualizarNivelIndicador(data.distance);
                
                // Actualizar el historial y guardar datos
                actualizarHistorial(data);
                
                // Guardar en el servidor
                guardarRegistro(data);
            })
            .catch(error => {
                console.error('Error al obtener datos actuales:', error);
                mostrarNotificacion('Error al obtener datos de los sensores', 'error');
            });
    }
    
    // Intentar primero WebSocket, y tener polling como respaldo
    const socket = conectarWebSocket();
    
    // Cargar datos guardados para la tabla de historial
    cargarHistorialGuardado();
    
    // Comprobar conexión y disponibilidad del servidor
    fetch('/api/current')
        .then(response => {
            if (!response.ok) {
                throw new Error('Error conectando con el servidor');
            }
            return response.json();
        })
        .then(data => {
            console.log('Conexión inicial exitosa, datos recibidos:', data);
            mostrarNotificacion('Sistema conectado correctamente', 'success');
            
            // Actualizar con los primeros datos recibidos
            document.getElementById("distance").innerText = data.distance.toFixed(1) + " cm";
            gauge.refresh(data.temperature);
            gHumidity.refresh(data.humidity);
            actualizarEstado(data.status);
            actualizarNivelIndicador(data.distance);
            actualizarHistorial(data);
        })
        .catch(error => {
            console.error('Error en la verificación inicial:', error);
            mostrarNotificacion('Error de conexión con el servidor', 'error');
        });
});