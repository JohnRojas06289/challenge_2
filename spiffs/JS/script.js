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
        fetch('/apagar', { method: 'POST' })
            .then(response => response.text())
            .then(data => {
                mostrarNotificacion(data, 'success');
                console.log('Respuesta del servidor:', data);
            })
            .catch(error => {
                console.error('Error al enviar comando:', error);
                mostrarNotificacion('Error al apagar alarmas', 'error');
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
    
    // Función para mostrar notificaciones
    function mostrarNotificacion(mensaje, tipo) {
        // Si existe una librería de notificaciones, usarla aquí
        console.log(`Notificación (${tipo}): ${mensaje}`);
        
        // Implementación básica (opcional)
        const notif = document.createElement('div');
        notif.className = `notificacion ${tipo}`;
        notif.textContent = mensaje;
        document.body.appendChild(notif);
        
        setTimeout(() => {
            notif.classList.add('mostrar');
            setTimeout(() => {
                notif.classList.remove('mostrar');
                setTimeout(() => {
                    document.body.removeChild(notif);
                }, 300);
            }, 3000);
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